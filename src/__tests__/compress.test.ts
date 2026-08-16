import { compressEvents } from "../analysis/compress.ts";
import { analyzeSession } from "../analysis/analyze.ts";
import type { LearnEvent, LearnSession } from "../types.ts";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const events: LearnEvent[] = [
  {
    timestamp: "2026-08-14T10:00:00.000Z",
    type: "app-change",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Untitled - Notepad",
  },
  {
    timestamp: "2026-08-14T10:00:02.000Z",
    type: "text",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Untitled - Notepad",
    text: "Hello World",
    element: { name: "Text Editor", controlType: "Document" },
  },
  {
    timestamp: "2026-08-14T10:00:04.000Z",
    type: "key",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Untitled - Notepad",
    key: "S",
    modifiers: ["Ctrl", "Shift"],
  },
  {
    timestamp: "2026-08-14T10:00:05.000Z",
    type: "window-change",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Save As",
  },
  {
    timestamp: "2026-08-14T10:00:06.000Z",
    type: "text",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Save As",
    text: "hello.txt",
    element: { name: "File name:", controlType: "Edit" },
  },
  {
    timestamp: "2026-08-14T10:00:07.000Z",
    type: "key",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Save As",
    key: "Enter",
  },
];

const steps = compressEvents(events);
assert(steps.length >= 4, `expected >=4 semantic steps, got ${steps.length}: ${steps.map((s) => s.intent).join(" | ")}`);
assert(steps.some((s) => /notepad/i.test(s.intent)), "open notepad");
assert(steps.some((s) => s.inputKey === "content"), "content input");
assert(steps.some((s) => /save as/i.test(s.intent)), "save as");
assert(steps.some((s) => s.inputKey === "filename"), "filename input");
assert(steps.some((s) => /confirm save/i.test(s.intent)), "confirm save");
assert(!steps.some((s) => /x=\d+/i.test(s.intent)), "no coordinates in steps");

const session: LearnSession = {
  sessionId: "test",
  startedAt: events[0].timestamp,
  endedAt: events.at(-1)!.timestamp,
  demonstrations: [
    {
      id: "d1",
      startedAt: events[0].timestamp,
      endedAt: events.at(-1)!.timestamp,
      events,
      applications: ["Notepad"],
      screenshots: [],
    },
  ],
  narration: [],
};

const preview = analyzeSession(session);
assert(preview.name === "create-text-file-with-notepad", preview.name);
assert(preview.inputs.content && preview.inputs.filename, "detected inputs");
assert(preview.steps.length >= 4, "preview steps");
assert(session.demonstrations.length === 1, "demonstrations[] present");
assert(Array.isArray(session.narration), "narration[] present");

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
const macSteps = compressEvents(macEvents);
assert(macSteps.some((s) => /textedit/i.test(s.application ?? "")), "TextEdit app");
assert(macSteps.some((s) => /save as/i.test(s.intent)), "Cmd+Shift+S is Save As");
const macSession: LearnSession = {
  sessionId: "mac1",
  startedAt: "t0",
  endedAt: "t2",
  demonstrations: [
    {
      id: "d1",
      startedAt: "t0",
      endedAt: "t2",
      events: macEvents,
      applications: ["TextEdit"],
      screenshots: [],
    },
  ],
  narration: [],
};
assert(analyzeSession(macSession).name === "create-text-file-with-textedit", "TextEdit skill name");

console.log("compress.test.ts ok");
