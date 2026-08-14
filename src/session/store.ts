import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RECORDINGS_DIR } from "../paths.ts";
import { sanitizeSession } from "../sanitize.ts";
import type { Demonstration, LearnEvent, LearnSession, ScreenshotRef } from "../types.ts";

export function newSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function sessionDir(sessionId: string): string {
  return path.join(RECORDINGS_DIR, sessionId);
}

export async function createSessionDir(sessionId: string): Promise<string> {
  const dir = sessionDir(sessionId);
  await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
  return dir;
}

export async function readJsonlEvents(dir: string): Promise<LearnEvent[]> {
  const file = path.join(dir, "events.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: LearnEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as LearnEvent);
    } catch {
      // skip malformed observer lines
    }
  }
  return events;
}

export async function listScreenshots(dir: string): Promise<ScreenshotRef[]> {
  const shotDir = path.join(dir, "screenshots");
  let names: string[] = [];
  try {
    names = await fs.readdir(shotDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort()
    .map((name) => ({
      path: `screenshots/${name}`,
      timestamp: "",
      reason: "observer",
    }));
}

export function buildSession(params: {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  events: LearnEvent[];
  screenshots: ScreenshotRef[];
}): LearnSession {
  const applications = uniqueApplications(params.events);
  const demonstration: Demonstration = {
    id: "d1",
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    events: params.events,
    applications,
    screenshots: params.screenshots,
  };
  return {
    sessionId: params.sessionId,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    demonstrations: [demonstration],
    narration: [],
  };
}

export function uniqueApplications(events: LearnEvent[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const event of events) {
    const name = event.application || event.processName;
    if (!name) continue;
    if (/learnobserver|learn.?mode/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export async function writeSession(dir: string, session: LearnSession): Promise<string> {
  const clean = sanitizeSession(session);
  const file = path.join(dir, "session.json");
  await fs.writeFile(file, JSON.stringify(clean, null, 2), "utf8");
  return file;
}

export async function readSession(dir: string): Promise<LearnSession> {
  const raw = await fs.readFile(path.join(dir, "session.json"), "utf8");
  return JSON.parse(raw) as LearnSession;
}

export async function writeStopSignal(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, "STOP"), "stop\n", "utf8");
}

export async function writeEventsJsonl(dir: string, events: LearnEvent[]): Promise<void> {
  const file = path.join(dir, "events.jsonl");
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  await fs.writeFile(file, body ? `${body}\n` : "", "utf8");
}

export async function removeSessionDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function writePauseSignal(dir: string, paused: boolean): Promise<void> {
  await fs.writeFile(path.join(dir, "PAUSE"), paused ? "1\n" : "0\n", "utf8");
}
