import fs from "node:fs/promises";
import path from "node:path";
import { SKILLS_DIR } from "../paths.ts";
import { assertNoSecrets } from "../sanitize.ts";
import { slugify } from "../analysis/analyze.ts";
import { renderSkillMarkdown } from "./skillMd.ts";
import type { Workflow } from "../types.ts";

export async function saveSkill(workflow: Workflow, skillsDir = SKILLS_DIR): Promise<{ dir: string; skillMd: string; workflowFile: string }> {
  const name = slugify(workflow.name);
  const safe: Workflow = { ...workflow, name };
  const dir = path.join(skillsDir, name);
  await fs.mkdir(dir, { recursive: true });
  const skillMd = renderSkillMarkdown(safe);
  const workflowJson = JSON.stringify(safe, null, 2);
  assertNoSecrets(workflowJson, "workflow.json");
  const skillFile = path.join(dir, "SKILL.md");
  const workflowFile = path.join(dir, "workflow.json");
  await fs.writeFile(skillFile, skillMd, "utf8");
  await fs.writeFile(workflowFile, `${workflowJson}\n`, "utf8");
  return { dir, skillMd: skillFile, workflowFile };
}
