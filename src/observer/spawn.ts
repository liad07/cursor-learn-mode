import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { LEARN_ROOT, OBSERVER_DIR, OBSERVER_EXE } from "../paths.ts";
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

export async function ensureObserverBuilt(): Promise<string> {
  if (await fileExists(OBSERVER_EXE)) return OBSERVER_EXE;
  const proc = spawn("dotnet", ["publish", "observer/LearnObserver.csproj", "-c", "Release", "-o", "observer/dist", "/nologo"], {
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
  if (code !== 0 || !(await fileExists(OBSERVER_EXE))) {
    throw new Error(`Failed to build Learn Observer.\n${Buffer.concat(stderr).toString("utf8")}`);
  }
  return OBSERVER_EXE;
}

export async function startObserver(sessionDir: string): Promise<ObserverHandle> {
  const exe = await ensureObserverBuilt();
  const child = spawn(exe, ["--session-dir", sessionDir], {
    cwd: OBSERVER_DIR,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    detached: false,
  });
  child.stderr?.on("data", () => {
    // observer diagnostics stay out of MCP stdio
  });
  try {
    const ready = await waitForStatus(sessionDir, 8000);
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
