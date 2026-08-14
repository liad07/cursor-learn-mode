import type { LearnEvent, SemanticStep } from "../types.ts";

const OVERLAY_PROCESS = /learnobserver|learn-mode|learn mode/i;
const SAVE_AS = /save as|שמירה בשם|speichern unter|enregistrer sous/i;
const SAVE = /^(save|שמור|speichern|enregistrer)$/i;
const NOTEPAD = /notepad/i;

function isNoise(event: LearnEvent): boolean {
  const proc = event.processName ?? "";
  const app = event.application ?? "";
  const title = event.windowTitle ?? "";
  if (OVERLAY_PROCESS.test(proc) || OVERLAY_PROCESS.test(app) || OVERLAY_PROCESS.test(title)) return true;
  if (event.type === "key" && event.text) return false;
  return false;
}

function displayApp(event: LearnEvent): string | undefined {
  if (event.processName && NOTEPAD.test(event.processName)) return "Notepad";
  return event.application || event.processName || undefined;
}

function isSaveAsContext(event: LearnEvent): boolean {
  return Boolean(event.windowTitle && SAVE_AS.test(event.windowTitle));
}

export function compressEvents(events: LearnEvent[]): SemanticStep[] {
  const steps: SemanticStep[] = [];
  let lastApp: string | undefined;
  let textBuffer = "";
  let textApp: string | undefined;
  let textTarget: string | undefined;
  let textSaveAs = false;
  let n = 0;

  const flushText = () => {
    const value = textBuffer.trim();
    textBuffer = "";
    if (!value) return;
    n += 1;
    if (textSaveAs) {
      steps.push({
        id: `s${n}`,
        intent: "Enter the destination file name",
        application: textApp,
        target: "Save As file name",
        inputKey: "filename",
        kind: "type",
      });
      return;
    }
    steps.push({
      id: `s${n}`,
      intent: "Type the document content",
      application: textApp,
      target: textTarget || "document",
      inputKey: "content",
      kind: "type",
    });
  };

  const push = (step: Omit<SemanticStep, "id">) => {
    n += 1;
    steps.push({ id: `s${n}`, ...step });
  };

  for (const event of events) {
    if (isNoise(event)) continue;
    const app = displayApp(event);

    if (event.type === "text" && event.text) {
      if (textBuffer && (textApp !== app || textSaveAs !== isSaveAsContext(event))) flushText();
      textApp = app;
      textTarget = event.element?.name || event.element?.controlType;
      textSaveAs = isSaveAsContext(event);
      textBuffer += event.text;
      continue;
    }

    if (event.type === "app-change" || event.type === "window-change") {
      if (app && app !== lastApp) {
        flushText();
        const opened = !lastApp;
        lastApp = app;
        push({
          intent: opened ? `Open ${app}` : `Switch to ${app}`,
          application: app,
          target: event.windowTitle,
          kind: opened ? "open-application" : "switch-application",
        });
      } else if (event.windowTitle && SAVE_AS.test(event.windowTitle)) {
        flushText();
        push({
          intent: "Open Save As",
          application: app,
          target: event.windowTitle,
          kind: "save",
        });
      }
      continue;
    }

    if (event.type === "key") {
      const combo = [...(event.modifiers ?? []), event.key ?? ""].filter(Boolean).join("+");
      if (event.key === "Enter" && event.windowTitle && SAVE_AS.test(event.windowTitle)) {
        flushText();
        push({
          intent: "Confirm Save",
          application: app,
          target: "Enter",
          kind: "save",
        });
        continue;
      }
      if (/^(Ctrl\+Shift\+S)$/i.test(combo) || combo.toLowerCase() === "ctrl+s") {
        flushText();
        push({
          intent: combo.toLowerCase() === "ctrl+s" ? "Save the file" : "Open Save As",
          application: app,
          target: combo,
          kind: "save",
        });
        continue;
      }
      if (/^Alt\+F$/i.test(combo)) {
        flushText();
        push({
          intent: "Open the File menu",
          application: app,
          target: combo,
          kind: "shortcut",
        });
      }
      continue;
    }

    if (event.type === "click") {
      flushText();
      const name = event.element?.name?.trim();
      if (name && /file name/i.test(name)) continue;
      if (name && SAVE_AS.test(name)) {
        push({
          intent: "Open Save As",
          application: app,
          target: name,
          kind: "save",
        });
        continue;
      }
      if (name && SAVE.test(name)) {
        push({
          intent: "Confirm Save",
          application: app,
          target: name,
          kind: "save",
        });
        continue;
      }
      if (name) {
        push({
          intent: `Click "${name}"`,
          application: app,
          target: name,
          kind: "click",
        });
      }
      continue;
    }

    if (event.type === "focus") {
      if (event.windowTitle && SAVE_AS.test(event.windowTitle)) {
        flushText();
        if (!steps.some((s) => s.kind === "save" && /save as/i.test(s.intent))) {
          push({
            intent: "Open Save As",
            application: app,
            target: event.windowTitle,
            kind: "save",
          });
        }
      }
    }
  }

  flushText();
  return dedupeSteps(steps);
}

function dedupeSteps(steps: SemanticStep[]): SemanticStep[] {
  const out: SemanticStep[] = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.intent === step.intent && prev.application === step.application && prev.kind === step.kind) {
      continue;
    }
    out.push(step);
  }
  return out.map((step, i) => ({ ...step, id: `s${i + 1}` }));
}
