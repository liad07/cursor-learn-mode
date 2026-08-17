#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpPath = path.join(os.homedir(), ".cursor", "mcp.json");
const serverEntry = path.join(root, "src", "mcp", "server.ts");

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function warn(msg) {
  console.log(`⚠ ${msg}`);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function majorNode() {
  return Number(process.versions.node.split(".")[0]);
}

function which(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8" });
  return result.status === 0;
}

function buildObserver() {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-observer.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
}

function mergeMcpConfig() {
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  let current = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try {
      current = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    } catch {
      fail(`Could not parse existing MCP config at ${mcpPath}`);
      return false;
    }
  }
  if (!current.mcpServers || typeof current.mcpServers !== "object") current.mcpServers = {};
  const tsxBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const command = fs.existsSync(tsxBin) ? tsxBin : "npx";
  const args = fs.existsSync(tsxBin) ? [serverEntry] : ["--yes", "tsx", serverEntry];
  current.mcpServers["learn-mode"] = { command, args };
  const tmp = `${mcpPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, mcpPath);
  return true;
}

console.log("\nCursor Learn Mode Setup\n");

if (majorNode() < 20) {
  fail(`Node.js 20+ required (found ${process.versions.node})`);
} else {
  ok(`Node.js ${process.versions.node}`);
}

if (fs.existsSync(path.dirname(mcpPath))) ok("Cursor config folder found");
else warn("Cursor config folder missing; it will be created");

if (process.platform === "win32") {
  ok("Windows detected");
  if (!which("dotnet")) fail(".NET SDK (dotnet) not found — required to build the Windows observer");
  else ok(".NET SDK found");
} else if (process.platform === "darwin") {
  ok("macOS detected");
  if (!which("swiftc")) fail("Swift compiler (swiftc) not found — install Xcode Command Line Tools");
  else ok("Swift compiler found");
} else {
  fail(`Unsupported platform: ${process.platform}`);
}

if (process.exitCode) {
  console.log("\nSetup incomplete.\n");
  process.exit(process.exitCode);
}

if (!fs.existsSync(path.join(root, "node_modules"))) {
  warn("node_modules missing — run npm install in the package directory first");
}

if (buildObserver()) ok("Learn Observer built");
else fail("Learn Observer build failed");

if (mergeMcpConfig()) ok(`MCP configuration installed (${mcpPath})`);
else fail("MCP configuration failed");

if (process.platform === "darwin") {
  warn("Enable Cursor under System Settings → Privacy & Security → Accessibility");
}

console.log(process.exitCode ? "\nSetup incomplete.\n" : "\nReady. Reload MCP in Cursor, then run /learn.\n");
