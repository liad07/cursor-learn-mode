import { analyzeSession, slugify, toWorkflow } from "../analysis/analyze.ts";
import { saveSkill } from "../generator/skillStore.ts";
import { startObserver, readStatus, waitForExit, type ObserverHandle } from "../observer/spawn.ts";
import { sanitizeEvent, sanitizeSession, stripDebugCoordinates } from "../sanitize.ts";
import {
  buildSession,
  createSessionDir,
  listScreenshots,
  newSessionId,
  readJsonlEvents,
  removeSessionDir,
  writeEventsJsonl,
  writePauseSignal,
  writeSession,
  writeStopSignal,
} from "../session/store.ts";
import type { AnalysisPreview, LearnSession, Workflow } from "../types.ts";

export type LearnState = "idle" | "recording" | "paused" | "stopped";

export class LearnController {
  state: LearnState = "idle";
  sessionId?: string;
  sessionDir?: string;
  startedAt?: string;
  observer?: ObserverHandle;
  session?: LearnSession;
  preview?: AnalysisPreview;
  workflow?: Workflow;

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
    this.sessionId = name ? `${slugify(name)}-${Date.now()}` : newSessionId();
    this.sessionDir = await createSessionDir(this.sessionId);
    this.startedAt = new Date().toISOString();
    this.observer = await startObserver(this.sessionDir);
    this.state = "recording";
    return { sessionId: this.sessionId, state: this.state };
  }

  async status(): Promise<{
    state: LearnState;
    sessionId?: string;
    startedAt?: string;
    eventCount: number;
    elapsedMs: number;
    preview?: string;
  }> {
    const observer = this.sessionDir ? await readStatus(this.sessionDir) : undefined;
    return {
      state: this.state,
      sessionId: this.sessionId,
      startedAt: observer?.startedAt ?? this.startedAt,
      eventCount: observer?.eventCount ?? 0,
      elapsedMs: observer?.elapsedMs ?? 0,
      preview: this.preview?.previewText,
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
    const session = sanitizeSession(
      buildSession({
        sessionId: this.sessionId,
        startedAt: this.startedAt,
        endedAt,
        events,
        screenshots,
      }),
    );
    const sessionFile = await writeSession(this.sessionDir, session);
    const preview = analyzeSession(session);
    this.session = session;
    this.preview = preview;
    this.workflow = toWorkflow(preview);
    this.state = "stopped";
    this.observer = undefined;
    return { session, preview, sessionFile };
  }

  async save(edits?: { name?: string; title?: string; inputs?: string[] }): Promise<{ dir: string; skillMd: string; workflowFile: string }> {
    if (!this.preview || !this.workflow) {
      throw new Error("Nothing to save. Stop a Learn session first.");
    }
    const workflow = structuredClone(this.workflow);
    if (edits?.name) workflow.name = slugify(edits.name);
    if (edits?.title) workflow.title = edits.title;
    if (edits?.inputs) {
      const keep = new Set(edits.inputs);
      workflow.inputs = Object.fromEntries(Object.entries(workflow.inputs).filter(([key]) => keep.has(key)));
      workflow.steps = workflow.steps.map((step) => (step.inputKey && !keep.has(step.inputKey) ? { ...step, inputKey: undefined } : step));
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
    this.state = "idle";
    this.sessionId = undefined;
    this.sessionDir = undefined;
    this.startedAt = undefined;
    this.observer = undefined;
    this.session = undefined;
    this.preview = undefined;
    this.workflow = undefined;
  }
}

export const learn = new LearnController();
