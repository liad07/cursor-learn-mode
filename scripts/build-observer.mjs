import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === "win32") {
  run("dotnet", ["publish", "observer/LearnObserver.csproj", "-c", "Release", "-o", "observer/dist", "/nologo"]);
} else if (process.platform === "darwin") {
  const outDir = path.join(root, "observer-mac", "dist");
  fs.mkdirSync(outDir, { recursive: true });
  run("swiftc", [
    "-O",
    "-o",
    path.join(outDir, "LearnObserver"),
    path.join(root, "observer-mac", "LearnObserver.swift"),
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "CoreGraphics",
    "-Xfrontend",
    "-disable-availability-checking",
  ]);
} else {
  console.error(`No Learn Observer for ${process.platform}. Use Windows or macOS.`);
  process.exit(1);
}
