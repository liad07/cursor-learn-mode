import { analyzeSession, slugify, toWorkflow } from "../analysis/analyze.ts";
import { saveSkill } from "../generator/skillStore.ts";
import { startObserver, readStatus, waitForExit, type ObserverHandle } from "../observer/spawn.ts";
import { sanitizeEvent, sanitizeSession, stripDebugCoordinates } from "../sanitize.ts";
import {
  appendDemonstration,
  buildSession,
  createSessionDir,
  listScreenshots,
  newSessionId,
  nextDemonstrationId,
  readJsonlEvents,
  readPrivacyOptions,
  removeSessionDir,
  sessionDir,
  writeEventsJsonl,
  writePauseSignal,
  writeSession,
  writeStopSignal,
} from "../session/store.ts";
import type {
  AnalysisPreview,
  Demonstration,
  LearnSession,
  PlatformId,
  SemanticStep,
  Workflow,
  WorkflowSaveEdits,
} from "../types.ts";
import { SKILLS_DIR } from "../paths.ts";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type LearnState = "idle" | "recording" | "paused" | "stopped";

const PACKAGE_VERSION = "0.3.0";

export class LearnController {
  state: LearnState = "idle";
  sessionId?: string;
  sessionDir?: string;
  startedAt?: string;
  observer?: ObserverHandle;
  session?: LearnSession;
  preview?: AnalysisPreview;
  workflow?: Workflow;
  private platform: PlatformId = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "unknown";
  private accumulatedDemos: Demonstration[] = [];
  private sessionStartedAt?: string;

  async open(): Promise<{ state: LearnState; message: string }> {
    return {
      state: this.state,
      message:
        this.state === "idle"
          ? "Learn Mode is ready. Start Learning to record a demonstration."
          : `Learn Mode is ${this.state}.`,
    };
  }

  async start(name?: string): Promise<{ sessionId: string; state: LearnState }> {
    if (this.state === "recording" || this.state === "paused") {
      throw new Error("A Learn session is already running. Stop it first.");
    }
    this.preview = undefined;
    this.workflow = undefined;
    this.session = undefined;
    this.accumulatedDemos = [];
    this.sessionId = name ? `${slugify(name)}-${Date.now()}` : newSessionId();
    this.sessionStartedAt = new Date().toISOString();
    this.startedAt = this.sessionStartedAt;
    this.sessionDir = await createSessionDir(this.sessionId);
    this.observer = await startObserver(this.sessionDir);
    this.state = "recording";
    return { sessionId: this.sessionId, state: this.state };
  }

  async addDemonstration(): Promise<{ sessionId: string; state: LearnState; demonstrationId: string }> {
    if (this.state !== "stopped" || !this.session || !this.sessionId) {
      throw new Error("Stop and review a demonstration before teaching another example.");
    }
    this.accumulatedDemos = [...this.session.demonstrations];
    const demonstrationId = nextDemonstrationId(this.accumulatedDemos);
    this.startedAt = new Date().toISOString();
    this.sessionDir = await createSessionDir(`${this.sessionId}-${demonstrationId}`);
    this.observer = await startObserver(this.sessionDir);
    this.state = "recording";
    this.preview = undefined;
    this.workflow = undefined;
    return { sessionId: this.sessionId, state: this.state, demonstrationId };
  }

  async status(): Promise<{
    state: LearnState;
    sessionId?: string;
    startedAt?: string;
    eventCount: number;
    elapsedMs: number;
    preview?: string;
    title?: string;
    name?: string;
    inputs?: AnalysisPreview["inputs"];
    steps?: SemanticStep[];
    demonstrationIds?: string[];
    platform?: PlatformId;
  }> {
    const observer = this.sessionDir ? await readStatus(this.sessionDir) : undefined;
    return {
      state: this.state,
      sessionId: this.sessionId,
      startedAt: observer?.startedAt ?? this.startedAt,
      eventCount: observer?.eventCount ?? 0,
      elapsedMs: observer?.elapsedMs ?? 0,
      preview: this.preview?.previewText,
      title: this.preview?.title,
      name: this.preview?.name,
      inputs: this.preview?.inputs,
      steps: this.preview?.steps,
      demonstrationIds: this.preview?.demonstrationIds,
      platform: this.preview?.platform ?? this.platform,
    };
  }

  async pause(): Promise<{ state: LearnState }> {
    if (this.state !== "recording" && this.state !== "paused") throw new Error("No active Learn session.");
    const next = this.state === "paused" ? "recording" : "paused";
    if (this.sessionDir) await writePauseSignal(this.sessionDir, next === "paused");
    this.state = next;
    return { state: this.state };
  }

  async stop(): Promise<{ session: LearnSession; preview: AnalysisPreview; sessionFile: string }> {
    if (!this.sessionDir || !this.sessionId || !this.startedAt) {
      throw new Error("No active Learn session.");
    }
    await writeStopSignal(this.sessionDir);
    if (this.observer) await waitForExit(this.observer, 5000);
    const endedAt = new Date().toISOString();
    const events = (await readJsonlEvents(this.sessionDir))
      .map(sanitizeEvent)
      .map(stripDebugCoordinates);
    await writeEventsJsonl(this.sessionDir, events);
    const screenshots = await listScreenshots(this.sessionDir);
    const privacy = await readPrivacyOptions(this.sessionDir);
    const demoId = nextDemonstrationId(this.accumulatedDemos);
    const partial = buildSession({
      sessionId: this.sessionId,
      startedAt: this.sessionStartedAt ?? this.startedAt,
      endedAt,
      events,
      screenshots,
      demonstrationId: demoId,
      platform: this.platform,
      recordedWith: { name: "cursor-learn-mode", version: PACKAGE_VERSION },
      recordingOptions: privacy,
    });
    const session = sanitizeSession(
      appendDemonstration(
        {
          sessionId: this.sessionId,
          startedAt: this.sessionStartedAt ?? this.startedAt,
          endedAt,
          platform: this.platform,
          recordedWith: { name: "cursor-learn-mode", version: PACKAGE_VERSION },
          recordingOptions: privacy,
          demonstrations: this.accumulatedDemos,
          narration: [],
        },
        partial.demonstrations[0],
      ),
    );
    const rootDir = await createSessionDir(this.sessionId);
    const sessionFile = await writeSession(rootDir, session);
    const preview = analyzeSession(session);
    this.session = session;
    this.accumulatedDemos = session.demonstrations;
    this.preview = preview;
    this.workflow = toWorkflow(preview, session);
    this.state = "stopped";
    this.observer = undefined;
    return { session, preview, sessionFile };
  }

  async save(edits?: WorkflowSaveEdits): Promise<{ dir: string; skillMd: string; workflowFile: string }> {
    if (!this.preview || !this.workflow) {
      throw new Error("Nothing to save. Stop a Learn session first.");
    }
    const workflow = structuredClone(this.workflow);
    if (edits?.name) workflow.name = slugify(edits.name);
    if (edits?.title) workflow.title = edits.title;
    if (edits?.steps) {
      workflow.steps = edits.steps.map((step, i) => ({
        id: step.id || `s${i + 1}`,
        intent: step.intent,
        application: step.application,
        target: step.target,
        inputKey: step.inputKey,
        constantValue: step.constantValue,
        kind: step.kind ?? "other",
      }));
    }
    if (edits?.inputs) {
      const keep = new Set(edits.inputs);
      workflow.inputs = Object.fromEntries(Object.entries(workflow.inputs).filter(([key]) => keep.has(key)));
      workflow.steps = workflow.steps.map((step) =>
        step.inputKey && !keep.has(step.inputKey) ? { ...step, inputKey: undefined } : step,
      );
    }
    const saved = await saveSkill(workflow);
    this.workflow = workflow;
    return saved;
  }

  async discard(): Promise<void> {
    const dir = this.sessionDir;
    if (this.state === "recording" || this.state === "paused") {
      if (dir) await writeStopSignal(dir);
      if (this.observer) await waitForExit(this.observer, 3000);
    }
    if (dir) await removeSessionDir(dir);
    if (this.sessionId) {
      try {
        await removeSessionDir(sessionDir(this.sessionId));
      } catch {
        // ignore
      }
      for (const demo of this.accumulatedDemos) {
        try {
          await removeSessionDir(sessionDir(`${this.sessionId}-${demo.id}`));
        } catch {
          // ignore
        }
      }
    }
    this.state = "idle";
    this.sessionId = undefined;
    this.sessionDir = undefined;
    this.startedAt = undefined;
    this.sessionStartedAt = undefined;
    this.observer = undefined;
    this.session = undefined;
    this.preview = undefined;
    this.workflow = undefined;
    this.accumulatedDemos = [];
  }

  async listSkills(): Promise<{ name: string; title?: string }[]> {
    let names: string[] = [];
    try {
      names = await readdir(SKILLS_DIR);
    } catch {
      return [];
    }
    const out: { name: string; title?: string }[] = [];
    for (const name of names) {
      const skillFile = path.join(SKILLS_DIR, name, "SKILL.md");
      try {
        if (!(await stat(skillFile)).isFile()) continue;
        const workflowFile = path.join(SKILLS_DIR, name, "workflow.json");
        try {
          if (!(await stat(workflowFile)).isFile()) continue;
        } catch {
          continue;
        }
        const raw = await readFile(skillFile, "utf8");
        const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
        out.push({ name, title });
      } catch {
        // skip folders that are not skills
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export const learn = new LearnController();
