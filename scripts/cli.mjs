#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command = "help", ...rest] = process.argv.slice(2);

if (command === "install") {
  const code = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), ...rest], {
    cwd: root,
    stdio: "inherit",
  }).status;
  process.exit(code ?? 1);
}

console.log(`cursor-learn-mode

Commands:
  install   Detect OS, build the observer, merge learn-mode into ~/.cursor/mcp.json

Learn Mode learns workflow intent. It is not a mouse macro recorder.
`);
