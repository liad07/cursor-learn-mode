import { collectTypedValues, detectInputs } from "./inputs.ts";
import { compressEvents } from "./compress.ts";
import type { AnalysisPreview, LearnEvent, LearnSession, Workflow } from "../types.ts";

function guessTitle(applications: string[], steps: AnalysisPreview["steps"]): { title: string; name: string; goal: string } {
  const apps = applications.map((a) => a.toLowerCase());
  const hasNotepad = apps.some((a) => a.includes("notepad"));
  const hasSave = steps.some((s) => s.kind === "save");
  if (hasNotepad && hasSave) {
    return {
      title: "Create Text File With Notepad",
      name: "create-text-file-with-notepad",
      goal: "Create a text file by opening Notepad, typing content, and saving it with Save As.",
    };
  }
  const primary = applications[0] ?? "Desktop";
  const name = slugify(`learned-${primary}-workflow`);
  return {
    title: `Learned ${primary} Workflow`,
    name,
    goal: `Repeat the demonstrated process across: ${applications.join(", ") || "the desktop"}.`,
  };
}

const RESERVED = new Set(["learn-workflow", "con", "prn", "aux", "nul", "com1", "lpt1"]);

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug || RESERVED.has(slug)) return "learned-workflow";
  return slug;
}

export function analyzeSession(session: LearnSession): AnalysisPreview {
  const demo = session.demonstrations[0];
  const events: LearnEvent[] = demo?.events ?? [];
  const steps = compressEvents(events);
  const applications = demo?.applications?.length ? demo.applications : [];
  const typed = collectTypedValues(steps, events);
  const inputs = detectInputs(steps, typed);
  const meta = guessTitle(applications, steps);
  const preconditions = [
    ...applications.map((app) => `${app} must be installed and launchable.`),
    "The user must be able to interact with the desktop (not a locked session).",
  ];
  const successConditions = successFor(meta.name, inputs);
  const previewText = renderPreview({ ...meta, applications, inputs, steps, preconditions, successConditions });
  return {
    ...meta,
    applications,
    inputs,
    steps,
    preconditions,
    successConditions,
    previewText,
  };
}

function successFor(name: string, inputs: AnalysisPreview["inputs"]): string[] {
  if (name === "create-text-file-with-notepad") {
    return [
      "Notepad Save As completed without an error dialog.",
      "The target file exists.",
      "The file contents match the provided content input.",
    ];
  }
  const names = Object.keys(inputs);
  if (names.length) return [`The workflow completed using inputs: ${names.join(", ")}.`];
  return ["The same end state observed in the demonstration is reached."];
}

export function toWorkflow(preview: AnalysisPreview): Workflow {
  return {
    name: preview.name,
    title: preview.title,
    description: preview.goal,
    version: 1,
    inputs: preview.inputs,
    applications: preview.applications,
    steps: preview.steps,
    preconditions: preview.preconditions,
    successConditions: preview.successConditions,
    demonstrations: ["d1"],
  };
}

function renderPreview(preview: Omit<AnalysisPreview, "previewText">): string {
  const inputLines = Object.keys(preview.inputs).length
    ? Object.entries(preview.inputs)
        .map(([key, spec]) => `• ${key}${spec.example ? ` (example: ${spec.example})` : ""}`)
        .join("\n")
    : "• (none detected)";
  const stepLines = preview.steps.map((step, i) => `${i + 1}. ${step.intent}`).join("\n") || "(no steps)";
  const appLines = preview.applications.map((app) => `• ${app}`).join("\n") || "• (none)";
  return [
    "🧠 Workflow Learned",
    "",
    `Name: ${preview.title}`,
    "",
    "Applications:",
    appLines,
    "",
    "Inputs",
    inputLines,
    "",
    "Steps",
    stepLines,
    "",
    "Tell Cursor to Save Skill, or call learn_save.",
  ].join("\n");
}
