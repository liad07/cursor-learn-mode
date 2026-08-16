import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { LEARN_ROOT, OBSERVER_DIR, OBSERVER_EXE, OBSERVER_MAC, OBSERVER_MAC_DIR } from "../paths.ts";
import type { ObserverStatus } from "../types.ts";

export type ObserverHandle = {
  process: ChildProcess;
  sessionDir: string;
};

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function observerPlatform(): "win32" | "darwin" {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  throw new Error(`Learn Mode recording is not supported on ${process.platform}. Use Windows or macOS.`);
}

export async function ensureObserverBuilt(): Promise<string> {
  const platform = observerPlatform();
  if (platform === "win32") {
    if (await fileExists(OBSERVER_EXE)) return OBSERVER_EXE;
    const code = await run("dotnet", ["publish", "observer/LearnObserver.csproj", "-c", "Release", "-o", "observer/dist", "/nologo"]);
    if (code !== 0 || !(await fileExists(OBSERVER_EXE))) {
      throw new Error("Failed to build the Windows Learn Observer.");
    }
    return OBSERVER_EXE;
  }
  if (await fileExists(OBSERVER_MAC)) return OBSERVER_MAC;
  await fs.mkdir(path.join(OBSERVER_MAC_DIR, "dist"), { recursive: true });
  const code = await run("swiftc", [
    "-O",
    "-o",
    OBSERVER_MAC,
    path.join(OBSERVER_MAC_DIR, "LearnObserver.swift"),
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "CoreGraphics",
  ]);
  if (code !== 0 || !(await fileExists(OBSERVER_MAC))) {
    throw new Error("Failed to build the macOS Learn Observer. Install Xcode Command Line Tools and enable Accessibility for Cursor.");
  }
  return OBSERVER_MAC;
}

async function run(command: string, args: string[]): Promise<number> {
  const proc = spawn(command, args, {
    cwd: LEARN_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderr: Buffer[] = [];
  proc.stderr?.on("data", (chunk) => stderr.push(chunk as Buffer));
  const code: number = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (value) => resolve(value ?? 1));
  });
  if (code !== 0 && stderr.length) {
    process.stderr.write(Buffer.concat(stderr));
  }
  return code;
}

export async function startObserver(sessionDir: string): Promise<ObserverHandle> {
  const exe = await ensureObserverBuilt();
  const child = spawn(exe, ["--session-dir", sessionDir], {
    cwd: path.dirname(exe),
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    detached: false,
  });
  child.stderr?.on("data", () => {
    // keep MCP stdio clean
  });
  try {
    const ready = await waitForStatus(sessionDir, 10000);
    if (!ready) {
      child.kill();
      throw new Error("Learn Observer did not start in time.");
    }
  } catch (error) {
    child.kill();
    throw error;
  }
  return { process: child, sessionDir };
}

export async function waitForExit(handle: ObserverHandle, timeoutMs: number): Promise<void> {
  if (handle.process.exitCode != null) return;
  await Promise.race([
    new Promise<void>((resolve) => handle.process.once("exit", () => resolve())),
    sleep(timeoutMs),
  ]);
  if (handle.process.exitCode == null) {
    handle.process.kill();
    await sleep(400);
  }
}

export async function readStatus(sessionDir: string): Promise<ObserverStatus | undefined> {
  try {
    const raw = await fs.readFile(path.join(sessionDir, "status.json"), "utf8");
    return JSON.parse(raw) as ObserverStatus;
  } catch {
    return undefined;
  }
}

async function waitForStatus(sessionDir: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await readStatus(sessionDir);
    if (status?.state === "failed") throw new Error(status.error || "Learn Observer failed to start.");
    if (status && (status.state === "recording" || status.state === "paused")) return true;
    await sleep(150);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
