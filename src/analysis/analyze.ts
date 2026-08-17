import { isSensitiveName } from "../sanitize.ts";
import type { WorkflowAnalyzer } from "./analyzer.ts";
import { compressToSemantics } from "./compress.ts";
import { detectInputs } from "./inputs.ts";
import type {
  AnalysisPreview,
  LearnEvent,
  LearnSession,
  PlatformId,
  SemanticStep,
  Workflow,
  WorkflowInput,
} from "../types.ts";

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

export class HeuristicWorkflowAnalyzer implements WorkflowAnalyzer {
  analyze(session: LearnSession): AnalysisPreview {
    const demos = session.demonstrations.filter((d) => d.events?.length);
    const demonstrationIds = demos.map((d) => d.id);
    const applications = mergeApplications(demos.map((d) => d.applications));
    const perDemo = demos.map((demo) => compressToSemantics(demo.events));
    const merged = mergeDemoSemantics(perDemo);
    const inputs = detectInputs(merged.steps, merged.typedValues);
    const meta = guessTitle(applications, merged.steps, inputs);
    const preconditions = [
      ...applications.map((app) => `${app} must be installed and launchable.`),
      "The user must be able to interact with the desktop (not a locked session).",
    ];
    const successConditions = successFor(meta.name, inputs, merged.steps);
    const platform = session.platform ?? inferPlatform(session);
    const previewBase = {
      ...meta,
      applications,
      inputs,
      steps: withInputPlaceholders(merged.steps),
      preconditions,
      successConditions,
      platform,
      demonstrationIds: demonstrationIds.length ? demonstrationIds : ["d1"],
    };
    return {
      ...previewBase,
      previewText: renderPreview(previewBase),
    };
  }
}

const defaultAnalyzer = new HeuristicWorkflowAnalyzer();

export function analyzeSession(session: LearnSession, analyzer: WorkflowAnalyzer = defaultAnalyzer): AnalysisPreview {
  const result = analyzer.analyze(session);
  if (result instanceof Promise) {
    throw new Error("Async analyzers must be awaited via analyzeSessionAsync.");
  }
  return result;
}

export async function analyzeSessionAsync(
  session: LearnSession,
  analyzer: WorkflowAnalyzer = defaultAnalyzer,
): Promise<AnalysisPreview> {
  return analyzer.analyze(session);
}

export function toWorkflow(preview: AnalysisPreview, session?: LearnSession): Workflow {
  return {
    name: preview.name,
    title: preview.title,
    description: preview.goal,
    version: 1,
    platform: preview.platform ?? session?.platform,
    recordedWith: session?.recordedWith,
    inputs: preview.inputs,
    applications: preview.applications,
    steps: preview.steps,
    preconditions: preview.preconditions,
    successConditions: preview.successConditions,
    demonstrations: preview.demonstrationIds.length ? preview.demonstrationIds : ["d1"],
  };
}

function mergeDemoSemantics(
  demos: Array<{ steps: SemanticStep[]; typedValues: { key: string; value: string }[] }>,
): { steps: SemanticStep[]; typedValues: { key: string; value: string }[] } {
  if (!demos.length) return { steps: [], typedValues: [] };
  if (demos.length === 1) return demos[0];

  const primary = demos[0].steps;
  const steps: SemanticStep[] = primary.map((step, index) => {
    if (step.kind !== "type" || !step.inputKey) return { ...step };
    const values = demos
      .map((demo) => demo.typedValues.find((item) => item.key === step.inputKey)?.value ?? demo.steps[index]?.constantValue)
      .filter((value): value is string => Boolean(value));
    const unique = [...new Set(values)];
    if (unique.length <= 1) {
      const value = unique[0];
      if (isSensitiveName(step.inputKey) || isSensitiveName(step.target)) {
        return { ...step, inputKey: undefined, constantValue: undefined };
      }
      return { ...step, constantValue: unique[0], inputKey: undefined };
    }
    return { ...step };
  });

  const typedValues = demos.flatMap((demo) => demo.typedValues).filter((item) => steps.some((step) => step.inputKey === item.key));
  return { steps: steps.map((step, i) => ({ ...step, id: `s${i + 1}` })), typedValues };
}

function withInputPlaceholders(steps: SemanticStep[]): SemanticStep[] {
  return steps.map((step) => {
    if (!step.inputKey) return step;
    if (step.intent.includes(`{{${step.inputKey}}}`)) return step;
    return {
      ...step,
      intent: step.intent.replace(/Enter the .+|Enter .+/i, `Enter {{${step.inputKey}}}`),
    };
  });
}

function guessTitle(
  applications: string[],
  steps: SemanticStep[],
  inputs: Record<string, WorkflowInput>,
): { title: string; name: string; goal: string } {
  const apps = applications.map((a) => a.toLowerCase());
  const hasNotepad = apps.some((a) => a.includes("notepad"));
  const hasTextEdit = apps.some((a) => a.includes("textedit"));
  const hasSave = steps.some((s) => s.kind === "save");
  const hasIssue = steps.some((s) => /issue/i.test(s.intent) || /issue/i.test(s.target ?? ""));
  const inputKeys = Object.keys(inputs);

  if (hasNotepad && hasSave) {
    return {
      title: "Create Text File With Notepad",
      name: "create-text-file-with-notepad",
      goal: "Create a text file by opening Notepad, typing content, and saving it with Save As.",
    };
  }
  if (hasTextEdit && hasSave) {
    return {
      title: "Create Text File With TextEdit",
      name: "create-text-file-with-textedit",
      goal: "Create a text file by opening TextEdit, typing content, and saving it.",
    };
  }
  if (hasIssue || inputKeys.includes("issue_title") || inputKeys.includes("title")) {
    return {
      title: "Create Issue",
      name: "create-issue",
      goal: "Create an issue using the demonstrated navigation and form fields.",
    };
  }
  if (inputKeys.includes("email") || inputKeys.includes("name") || inputKeys.includes("plan")) {
    const primary = applications[0] ?? "Browser";
    return {
      title: `Fill ${primary} Form`,
      name: slugify(`fill-${primary}-form`),
      goal: `Fill the demonstrated form fields (${inputKeys.join(", ")}) and complete the workflow.`,
    };
  }
  const primary = applications[0] ?? "Desktop";
  return {
    title: `Learned ${primary} Workflow`,
    name: slugify(`learned-${primary}-workflow`),
    goal: `Repeat the demonstrated process across: ${applications.join(", ") || "the desktop"}.`,
  };
}

function successFor(name: string, inputs: Record<string, WorkflowInput>, steps: SemanticStep[]): string[] {
  if (name === "create-text-file-with-notepad" || name === "create-text-file-with-textedit") {
    return [
      "Save completed without an error dialog.",
      "The target file exists.",
      "The file contents match the provided content input.",
    ];
  }
  if (steps.some((s) => /submit|create issue|save/i.test(s.intent))) {
    return ["The form or save action completed without an error dialog."];
  }
  const names = Object.keys(inputs);
  if (names.length) return [`The workflow completed using inputs: ${names.join(", ")}.`];
  return ["The same end state observed in the demonstration is reached."];
}

function mergeApplications(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const app of list) {
      const key = app.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(app);
    }
  }
  return out;
}

function inferPlatform(session: LearnSession): PlatformId {
  if (session.platform) return session.platform;
  const blob = JSON.stringify(session.demonstrations.map((d) => d.events.map((e) => e.modifiers)));
  if (/\bCmd\b/.test(blob)) return "darwin";
  if (/\bCtrl\b/.test(blob)) return "win32";
  return "unknown";
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
    `Skill: ${preview.name}`,
    preview.platform ? `Platform: ${preview.platform}` : "",
    preview.demonstrationIds.length > 1 ? `Demonstrations: ${preview.demonstrationIds.join(", ")}` : "",
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
    "Review in Learn Mode, Teach Another Example, or Save Skill.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type { LearnEvent };
