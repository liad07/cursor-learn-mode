import { isSensitiveName } from "../sanitize.ts";
import { cleanLabel, slugifyLabel } from "./normalize.ts";
import type { LearnEvent, SemanticStep, WorkflowInput } from "../types.ts";

const SAVE_AS = /save as|שמירה בשם|speichern unter|enregistrer sous|export as/i;
const RESERVED = new Set(["con", "prn", "aux", "nul", "content", "filename"]);

export function isSaveAsContext(event: LearnEvent): boolean {
  return Boolean(event.windowTitle && SAVE_AS.test(event.windowTitle));
}

export function inferInputKey(event: LearnEvent, used: Set<string>): string {
  if (isSaveAsContext(event) || /file\s*name/i.test(event.element?.name ?? "")) {
    return uniqueKey("filename", used);
  }
  const control = (event.element?.controlType ?? "").toLowerCase();
  const appBlob = `${event.application ?? ""} ${event.processName ?? ""}`;
  if (/document/i.test(control) && /notepad|textedit/i.test(appBlob)) {
    return uniqueKey("content", used);
  }
  if (/text editor|document/i.test(event.element?.name ?? "") && /notepad|textedit/i.test(appBlob)) {
    return uniqueKey("content", used);
  }
  const label = cleanLabel(event.element?.name) || cleanLabel(event.element?.automationId);
  if (label) {
    const fromLabel = slugifyLabel(label);
    if (fromLabel && fromLabel !== "text_input") return uniqueKey(fromLabel, used);
  }
  if (/document/i.test(control)) return uniqueKey("content", used);
  let n = 1;
  while (used.has(`text_input_${n}`) || RESERVED.has(`text_input_${n}`)) n += 1;
  const key = `text_input_${n}`;
  used.add(key);
  return key;
}

export function intentForInput(key: string, label?: string): string {
  if (key === "filename") return "Enter the destination file name";
  if (key === "content") return "Enter the document content";
  if (label) return `Enter the ${label}`;
  return `Enter ${key.replace(/_/g, " ")}`;
}

export function collectTypedValues(
  steps: SemanticStep[],
  events: LearnEvent[],
): { key: string; value: string }[] {
  const buffers = new Map<string, string>();
  const used = new Set<string>();
  for (const event of events) {
    if (event.type !== "text" || !event.text || event.redacted) continue;
    const key = inferInputKey(event, used);
    buffers.set(key, (buffers.get(key) ?? "") + event.text);
  }
  const values: { key: string; value: string }[] = [];
  for (const step of steps) {
    if (!step.inputKey) continue;
    const value = buffers.get(step.inputKey)?.trim();
    if (value) values.push({ key: step.inputKey, value });
  }
  return values;
}

export function detectInputs(steps: SemanticStep[], typedValues: { key: string; value: string }[]): Record<string, WorkflowInput> {
  const inputs: Record<string, WorkflowInput> = {};
  for (const step of steps) {
    if (!step.inputKey) continue;
    if (step.constantValue != null && step.constantValue !== "") continue;
    const sample = typedValues.find((item) => item.key === step.inputKey)?.value;
    if (isSensitiveName(step.inputKey) || isSensitiveName(step.target) || isSensitiveName(sample)) {
      continue;
    }
    inputs[step.inputKey] = {
      type: "string",
      required: true,
      example: sample,
      source: step.target,
    };
  }
  return inputs;
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  const key = `${base}_${n}`;
  used.add(key);
  return key;
}
