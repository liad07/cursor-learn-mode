import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toWorkflow } from "../analysis/analyze.ts";
import { analyzeSession } from "../analysis/analyze.ts";
import { saveSkill } from "../generator/skillStore.ts";
import { renderSkillMarkdown } from "../generator/skillMd.ts";
import type { LearnEvent, LearnSession } from "../types.ts";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const events: LearnEvent[] = [
  { timestamp: "t0", type: "app-change", application: "Notepad", processName: "notepad", windowTitle: "Untitled - Notepad" },
  { timestamp: "t1", type: "text", application: "Notepad", processName: "notepad", windowTitle: "Untitled - Notepad", text: "Hello World" },
  { timestamp: "t2", type: "window-change", application: "Notepad", processName: "notepad", windowTitle: "Save As" },
  { timestamp: "t3", type: "text", application: "Notepad", processName: "notepad", windowTitle: "Save As", text: "hello.txt" },
  { timestamp: "t4", type: "click", application: "Notepad", processName: "notepad", windowTitle: "Save As", element: { name: "Save" } },
];

const session: LearnSession = {
  sessionId: "s1",
  startedAt: "t0",
  endedAt: "t4",
  demonstrations: [{ id: "d1", startedAt: "t0", endedAt: "t4", events, applications: ["Notepad"], screenshots: [] }],
  narration: [],
};

const preview = analyzeSession(session);
const workflow = toWorkflow(preview);
const md = renderSkillMarkdown(workflow);
assert(!/\bclick_at\b/.test(md), "skill must not mention click_at");
assert(!/x=\d+/.test(md), "skill must not contain coordinates");
assert(!/playwrightLocator/.test(md), "skill must not contain playwright locators");
assert(/Windows Computer MCP/.test(md), "skill must point at existing Windows Computer MCP");
assert(/Do not invent a new automation engine/.test(md), "tool-agnostic reminder");
assert(workflow.inputs.filename && workflow.inputs.content, "workflow inputs");
assert(Array.isArray(workflow.demonstrations), "workflow tracks demonstrations");

const dir = await mkdtemp(path.join(os.tmpdir(), "learn-skill-"));
try {
  const saved = await saveSkill(workflow, dir);
  const skill = await readFile(saved.skillMd, "utf8");
  const json = await readFile(saved.workflowFile, "utf8");
  assert(skill.includes("# Create Text File With Notepad"), "SKILL.md title");
  assert(json.includes('"filename"'), "workflow.json has filename");
  assert(!json.includes("playwrightLocator"), "no playwright in workflow.json");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("generator.test.ts ok");
