import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toWorkflow, analyzeSession } from "../analysis/analyze.ts";
import { saveSkill } from "../generator/skillStore.ts";
import { renderSkillMarkdown } from "../generator/skillMd.ts";
import { notepadSaveEvents, sessionFromEvents } from "./fixtures/sessions.ts";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const session = sessionFromEvents(notepadSaveEvents, ["Notepad"], { platform: "win32" });
const preview = analyzeSession(session);
const workflow = toWorkflow(preview, session);
const md = renderSkillMarkdown(workflow);
assert(!/\bclick_at\b/.test(md), "skill must not mention click_at");
assert(!/x=\d+/.test(md), "skill must not contain coordinates");
assert(!/playwrightLocator/.test(md), "skill must not contain playwright locators");
assert(/Windows Computer MCP/.test(md), "skill must point at existing Windows Computer MCP");
assert(!/For macOS desktop interaction/.test(md), "windows-only skill should not push macOS tools first");
assert(/Do not invent a new automation engine/.test(md), "tool-agnostic reminder");
assert(/Learn Mode learns workflow intent/.test(md), "intent statement");
assert(workflow.inputs.filename && workflow.inputs.content, "workflow inputs");
assert(workflow.demonstrations.join(",") === "d1", "demo ids");
assert(workflow.platform === "win32", "platform metadata");

const dir = await mkdtemp(path.join(os.tmpdir(), "learn-skill-"));
try {
  const saved = await saveSkill(workflow, dir);
  const skill = await readFile(saved.skillMd, "utf8");
  const json = await readFile(saved.workflowFile, "utf8");
  assert(skill.includes("# Create Text File With Notepad"), "SKILL.md title");
  assert(json.includes('"filename"'), "workflow.json has filename");
  assert(json.includes('"platform"'), "workflow.json has platform");
  assert(!json.includes("playwrightLocator"), "no playwright in workflow.json");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("generator.test.ts ok");
