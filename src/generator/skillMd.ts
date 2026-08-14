import { assertNoSecrets } from "../sanitize.ts";
import type { Workflow } from "../types.ts";

export function renderSkillMarkdown(workflow: Workflow): string {
  const inputLines = Object.keys(workflow.inputs).length
    ? Object.entries(workflow.inputs)
        .map(([key, spec]) => `- ${key} (${spec.type}${spec.required ? ", required" : ""})${spec.example ? ` — example: ${spec.example}` : ""}`)
        .join("\n")
    : "- (none)";
  const stepLines = workflow.steps.map((step, i) => `${i + 1}. ${step.intent}${step.application ? ` (${step.application})` : ""}.`).join("\n");
  const pre = workflow.preconditions.map((item) => `- ${item}`).join("\n");
  const success = workflow.successConditions.map((item) => `- ${item}`).join("\n");
  const md = `---
name: ${workflow.name}
description: ${workflow.description} Use when the user asks to ${workflow.title.toLowerCase()}, repeat this learned workflow, or mentions ${workflow.name}.
---

# ${workflow.title}

Use this skill when the user asks to perform this learned process.

## Inputs

${inputLines}

## Workflow

${stepLines || "1. Repeat the demonstrated intent using available tools."}

## Tools

Use the tools currently available to the Cursor Agent.

For Windows desktop interaction, use the existing Windows Computer MCP.

For browser interaction, use the existing browser automation tools.

For terminal interaction, use the existing terminal tools.

Do not invent a new automation engine. Do not replay mouse coordinates. Do not call Learn Mode tools to execute this workflow.

## Safety

If multiple targets match (files, rows, buttons, customers), ask the user which one they mean.

Do not choose arbitrarily.

If the live UI is significantly different from this demonstration, stop and ask instead of guessing.

Never click a destructive or bulk action (for example "Approve All" vs "Approve") unless the user confirmed it.

## Preconditions

${pre}

## Success

${success}

Authentication secrets, passwords, tokens, cookies, and API keys must not be stored in this skill. Use the user's current session.
`;
  assertNoSecrets(md, "SKILL.md");
  return md;
}
