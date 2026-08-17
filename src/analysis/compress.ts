import { cleanLabel, displayApp, isNoise, normalizeEvents } from "./normalize.ts";
import { inferInputKey, intentForInput, isSaveAsContext } from "./inputs.ts";
import type { LearnEvent, SemanticStep } from "../types.ts";

const SAVE_AS = /save as|שמירה בשם|speichern unter|enregistrer sous|export as/i;
const SAVE = /^(save|שמור|speichern|enregistrer)$/i;

export type CompressResult = {
  steps: SemanticStep[];
  typedValues: { key: string; value: string }[];
};

export function compressEvents(events: LearnEvent[]): SemanticStep[] {
  return compressToSemantics(events).steps;
}

export function compressToSemantics(events: LearnEvent[]): CompressResult {
  const normalized = normalizeEvents(events);
  const steps: SemanticStep[] = [];
  const typedValues: { key: string; value: string }[] = [];
  const usedKeys = new Set<string>();
  let lastApp: string | undefined;
  let textBuffer = "";
  let textApp: string | undefined;
  let textTarget: string | undefined;
  let textLabel: string | undefined;
  let textKey: string | undefined;
  let textSeed: LearnEvent | undefined;
  let n = 0;

  const flushText = () => {
    const value = textBuffer.trim();
    textBuffer = "";
    if (!value || !textKey) {
      textKey = undefined;
      textSeed = undefined;
      return;
    }
    n += 1;
    steps.push({
      id: `s${n}`,
      intent: intentForInput(textKey, textLabel),
      application: textApp,
      target: textTarget || textLabel || textKey,
      inputKey: textKey,
      kind: "type",
    });
    typedValues.push({ key: textKey, value });
    textKey = undefined;
    textSeed = undefined;
  };

  const push = (step: Omit<SemanticStep, "id">) => {
    n += 1;
    steps.push({ id: `s${n}`, ...step });
  };

  for (const event of normalized) {
    if (isNoise(event)) continue;
    const app = displayApp(event) ?? event.application;

    if (event.type === "text" && event.text) {
      if (event.redacted) {
        flushText();
        continue;
      }
      const sameField =
        textBuffer &&
        textApp === app &&
        textTarget === (event.element?.name || event.element?.controlType) &&
        isSaveAsContext(event) === (textSeed ? isSaveAsContext(textSeed) : false);
      if (textBuffer && !sameField) flushText();
      textApp = app;
      textTarget = event.element?.name || event.element?.controlType;
      textLabel = cleanLabel(event.element?.name);
      textSeed = event;
      if (!textKey) textKey = inferInputKey(event, usedKeys);
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
      } else if (event.windowTitle && /issues?|new issue|pull request/i.test(event.windowTitle)) {
        flushText();
        push({
          intent: `Navigate to ${event.windowTitle}`,
          application: app,
          target: event.windowTitle,
          kind: "navigate",
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
      if (/^(Ctrl\+Shift\+S|Cmd\+Shift\+S)$/i.test(combo) || /^(ctrl|cmd)\+s$/i.test(combo)) {
        flushText();
        push({
          intent: /shift/i.test(combo) ? "Open Save As" : "Save the file",
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
      if (name && /submit|create|create issue|post|send/i.test(name)) {
        push({
          intent: `Click "${name}"`,
          application: app,
          target: name,
          kind: "click",
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
  return { steps: dedupeSteps(steps), typedValues };
}

function dedupeSteps(steps: SemanticStep[]): SemanticStep[] {
  const out: SemanticStep[] = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.intent === step.intent && prev.application === step.application && prev.kind === step.kind && prev.inputKey === step.inputKey) {
      continue;
    }
    out.push(step);
  }
  return out.map((step, i) => ({ ...step, id: `s${i + 1}` }));
}
