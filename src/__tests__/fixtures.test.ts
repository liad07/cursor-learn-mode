import { analyzeSession, toWorkflow } from "../analysis/analyze.ts";
import { compressEvents } from "../analysis/compress.ts";
import { renderSkillMarkdown } from "../generator/skillMd.ts";
import {
  browserFormEvents,
  explorerEvents,
  githubIssueEvents,
  mixedBrowserDesktopEvents,
  notepadSaveEvents,
  sessionFromEvents,
  terminalBrowserEvents,
} from "./fixtures/sessions.ts";
import type { LearnEvent, LearnSession } from "../types.ts";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

function assertNoCoords(steps: { intent: string }[], label: string): void {
  assert(!steps.some((s) => /x=\d+|y=\d+|click_at/i.test(s.intent)), `${label}: no coordinates`);
}

const notepadSteps = compressEvents(notepadSaveEvents);
assert(notepadSteps.some((s) => s.inputKey === "content"), "notepad content");
assert(notepadSteps.some((s) => s.inputKey === "filename"), "notepad filename");
assert(notepadSteps.some((s) => /save as/i.test(s.intent)), "notepad save as");
assertNoCoords(notepadSteps, "notepad");
const notepadPreview = analyzeSession(sessionFromEvents(notepadSaveEvents, ["Notepad"], { platform: "win32" }));
assert(notepadPreview.name === "create-text-file-with-notepad", notepadPreview.name);
assert(notepadPreview.inputs.content && notepadPreview.inputs.filename, "notepad inputs");

const macEvents: LearnEvent[] = [
  {
    timestamp: "2026-08-16T10:00:00.000Z",
    type: "app-change",
    application: "TextEdit",
    processName: "TextEdit",
    windowTitle: "Untitled",
  },
  {
    timestamp: "2026-08-16T10:00:02.000Z",
    type: "text",
    application: "TextEdit",
    processName: "TextEdit",
    windowTitle: "Untitled",
    text: "Hello Mac",
    element: { name: "Text Editor", controlType: "AXTextArea" },
  },
  {
    timestamp: "2026-08-16T10:00:04.000Z",
    type: "key",
    application: "TextEdit",
    processName: "TextEdit",
    windowTitle: "Untitled",
    key: "S",
    modifiers: ["Cmd", "Shift"],
  },
];
assert(analyzeSession(sessionFromEvents(macEvents, ["TextEdit"], { platform: "darwin" })).name === "create-text-file-with-textedit", "textedit");

const formSteps = compressEvents(browserFormEvents);
assert(formSteps.some((s) => s.inputKey === "name"), `form name key: ${formSteps.map((s) => s.inputKey).join(",")}`);
assert(formSteps.some((s) => s.inputKey === "email"), "form email");
assert(formSteps.some((s) => s.inputKey === "plan"), "form plan");
assert(!formSteps.some((s) => s.inputKey === "content"), "form must not use content");
assertNoCoords(formSteps, "form");
const formPreview = analyzeSession(sessionFromEvents(browserFormEvents, ["Chrome"]));
assert(formPreview.inputs.email && formPreview.inputs.name && formPreview.inputs.plan, "form inputs");

const issueSteps = compressEvents(githubIssueEvents);
assert(issueSteps.some((s) => s.inputKey === "issue_title"), `issue title: ${issueSteps.map((s) => s.inputKey).join(",")}`);
assert(issueSteps.some((s) => /new issue/i.test(s.intent)), "new issue click");
assert(issueSteps.some((s) => s.inputKey === "assignees"), "assignee");
assertNoCoords(issueSteps, "github");
const issueMd = renderSkillMarkdown(toWorkflow(analyzeSession(sessionFromEvents(githubIssueEvents, ["Chrome"], { platform: "win32" }))));
assert(/{{issue_title}}|issue_title/.test(issueMd), "skill mentions issue_title");
assert(!/x=\d+/.test(issueMd), "skill no coords");
assert(/Windows Computer MCP/.test(issueMd), "windows guidance");

const explorerSteps = compressEvents(explorerEvents);
assert(explorerSteps.some((s) => /explorer/i.test(s.application ?? "")), "explorer app");
assert(explorerSteps.some((s) => s.inputKey === "name"), "folder name");
assertNoCoords(explorerSteps, "explorer");

const mixed = compressEvents(mixedBrowserDesktopEvents);
assert(mixed.some((s) => /switch to notepad/i.test(s.intent)), "switch apps");
assert(mixed.some((s) => s.inputKey === "invoice_number"), "invoice number");
assert(mixed.some((s) => s.inputKey === "content"), "notepad content after switch");
assertNoCoords(mixed, "mixed");

const terminal = compressEvents(terminalBrowserEvents);
assert(terminal.some((s) => /terminal/i.test(s.application ?? "")), "terminal");
assert(terminal.some((s) => /switch to chrome/i.test(s.intent)), "terminal to browser");
assertNoCoords(terminal, "terminal-browser");

const demo2Events = browserFormEvents.map((event) => {
  if (event.element?.name === "Name") return { ...event, text: "David" };
  if (event.element?.name === "Email") return { ...event, text: "david@example.com" };
  if (event.element?.name === "Plan") return { ...event, text: "Free" };
  return event;
});
const multi: LearnSession = {
  sessionId: "multi",
  startedAt: "t0",
  endedAt: "t9",
  platform: "win32",
  demonstrations: [
    {
      id: "d1",
      startedAt: "t0",
      endedAt: "t4",
      events: browserFormEvents,
      applications: ["Chrome"],
      screenshots: [],
    },
    {
      id: "d2",
      startedAt: "t5",
      endedAt: "t9",
      events: demo2Events,
      applications: ["Chrome"],
      screenshots: [],
    },
  ],
  narration: [],
};
const multiPreview = analyzeSession(multi);
assert(multiPreview.demonstrationIds.includes("d1") && multiPreview.demonstrationIds.includes("d2"), "multi demo ids");
assert(multiPreview.inputs.name && multiPreview.inputs.email && multiPreview.inputs.plan, "multi variable inputs");
const multiWorkflow = toWorkflow(multiPreview, multi);
assert(multiWorkflow.demonstrations.join(",") === "d1,d2", multiWorkflow.demonstrations.join(","));

console.log("fixtures.test.ts ok");
