import type { SemanticStep, WorkflowInput } from "../types.ts";

export function detectInputs(steps: SemanticStep[], typedValues: { key: string; value: string }[]): Record<string, WorkflowInput> {
  const inputs: Record<string, WorkflowInput> = {};
  for (const step of steps) {
    if (!step.inputKey) continue;
    const sample = typedValues.find((item) => item.key === step.inputKey)?.value;
    inputs[step.inputKey] = {
      type: "string",
      required: true,
      example: sample,
      source: step.target,
    };
  }
  return inputs;
}

export function collectTypedValues(steps: SemanticStep[], events: { type: string; text?: string; windowTitle?: string }[]): { key: string; value: string }[] {
  const saveAs = /save as|שמירה בשם|speichern unter|enregistrer sous/i;
  let content = "";
  let filename = "";
  for (const event of events) {
    if (event.type !== "text" || !event.text) continue;
    if (event.windowTitle && saveAs.test(event.windowTitle)) filename += event.text;
    else content += event.text;
  }
  const values: { key: string; value: string }[] = [];
  if (steps.some((s) => s.inputKey === "content") && content.trim()) {
    values.push({ key: "content", value: content.trim() });
  }
  if (steps.some((s) => s.inputKey === "filename") && filename.trim()) {
    values.push({ key: "filename", value: filename.trim() });
  }
  return values;
}
