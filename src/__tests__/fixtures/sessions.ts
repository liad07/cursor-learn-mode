import type { Demonstration, LearnEvent, LearnSession } from "../../types.ts";

export function sessionFromEvents(
  events: LearnEvent[],
  applications: string[],
  extras?: Partial<LearnSession> & { demos?: Demonstration[] },
): LearnSession {
  const demo: Demonstration = {
    id: "d1",
    startedAt: events[0]?.timestamp ?? "t0",
    endedAt: events.at(-1)?.timestamp ?? "t1",
    events,
    applications,
    screenshots: [],
  };
  return {
    sessionId: extras?.sessionId ?? "fixture",
    startedAt: extras?.startedAt ?? demo.startedAt,
    endedAt: extras?.endedAt ?? demo.endedAt,
    platform: extras?.platform,
    recordedWith: extras?.recordedWith,
    recordingOptions: extras?.recordingOptions,
    demonstrations: extras?.demos ?? extras?.demonstrations ?? [demo],
    narration: extras?.narration ?? [],
  };
}

export const notepadSaveEvents: LearnEvent[] = [
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

export const browserFormEvents: LearnEvent[] = [
  {
    timestamp: "t0",
    type: "app-change",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Signup - Example",
  },
  {
    timestamp: "t1",
    type: "text",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Signup - Example",
    text: "John",
    element: { name: "Name", controlType: "Edit", automationId: "name" },
  },
  {
    timestamp: "t2",
    type: "text",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Signup - Example",
    text: "john@example.com",
    element: { name: "Email", controlType: "Edit", automationId: "email" },
  },
  {
    timestamp: "t3",
    type: "text",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Signup - Example",
    text: "Pro",
    element: { name: "Plan", controlType: "Edit" },
  },
  {
    timestamp: "t4",
    type: "click",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Signup - Example",
    element: { name: "Submit", controlType: "Button" },
  },
];

export const githubIssueEvents: LearnEvent[] = [
  {
    timestamp: "t0",
    type: "app-change",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Issues · example/repo",
  },
  {
    timestamp: "t1",
    type: "click",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Issues · example/repo",
    element: { name: "New issue", controlType: "Button" },
  },
  {
    timestamp: "t2",
    type: "text",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "New issue",
    text: "Login button broken",
    element: { name: "Issue title", controlType: "Edit" },
  },
  {
    timestamp: "t3",
    type: "click",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "New issue",
    element: { name: "Bug", controlType: "Button" },
  },
  {
    timestamp: "t4",
    type: "text",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "New issue",
    text: "alice",
    element: { name: "Assignees", controlType: "Edit" },
  },
  {
    timestamp: "t5",
    type: "click",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "New issue",
    element: { name: "Submit new issue", controlType: "Button" },
  },
];

export const explorerEvents: LearnEvent[] = [
  {
    timestamp: "t0",
    type: "app-change",
    application: "Explorer",
    processName: "explorer",
    windowTitle: "Documents",
  },
  {
    timestamp: "t1",
    type: "click",
    application: "Explorer",
    processName: "explorer",
    windowTitle: "Documents",
    element: { name: "New folder", controlType: "Button" },
  },
  {
    timestamp: "t2",
    type: "text",
    application: "Explorer",
    processName: "explorer",
    windowTitle: "Documents",
    text: "Reports",
    element: { name: "Name", controlType: "Edit" },
  },
];

export const mixedBrowserDesktopEvents: LearnEvent[] = [
  {
    timestamp: "t0",
    type: "app-change",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Invoice portal",
  },
  {
    timestamp: "t1",
    type: "text",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "Invoice portal",
    text: "ACME-42",
    element: { name: "Invoice number", controlType: "Edit" },
  },
  {
    timestamp: "t2",
    type: "app-change",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Untitled - Notepad",
  },
  {
    timestamp: "t3",
    type: "text",
    application: "Notepad",
    processName: "notepad",
    windowTitle: "Untitled - Notepad",
    text: "Follow up ACME-42",
    element: { name: "Text Editor", controlType: "Document" },
  },
];

export const terminalBrowserEvents: LearnEvent[] = [
  {
    timestamp: "t0",
    type: "app-change",
    application: "Terminal",
    processName: "WindowsTerminal",
    windowTitle: "PowerShell",
  },
  {
    timestamp: "t1",
    type: "text",
    application: "Terminal",
    processName: "WindowsTerminal",
    windowTitle: "PowerShell",
    text: "npm test",
    element: { name: "Text Area", controlType: "Edit" },
  },
  {
    timestamp: "t2",
    type: "app-change",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "CI Results",
  },
  {
    timestamp: "t3",
    type: "click",
    application: "Chrome",
    processName: "chrome",
    windowTitle: "CI Results",
    element: { name: "Open run", controlType: "Hyperlink" },
  },
];
