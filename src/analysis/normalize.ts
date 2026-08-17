import type { LearnEvent } from "../types.ts";

const OVERLAY = /learnobserver|learn-mode|learn mode/i;

export function normalizeEvents(events: LearnEvent[]): LearnEvent[] {
  return events
    .filter((event) => !isNoise(event))
    .map((event) => ({
      ...event,
      application: displayApp(event),
      element: event.element
        ? {
            ...event.element,
            name: cleanLabel(event.element.name),
            controlType: event.element.controlType,
            automationId: event.element.automationId,
          }
        : undefined,
    }));
}

export function isNoise(event: LearnEvent): boolean {
  const proc = event.processName ?? "";
  const app = event.application ?? "";
  const title = event.windowTitle ?? "";
  if (OVERLAY.test(proc) || OVERLAY.test(app) || OVERLAY.test(title)) return true;
  return false;
}

export function displayApp(event: LearnEvent): string | undefined {
  const proc = (event.processName ?? "").toLowerCase();
  const app = (event.application ?? "").toLowerCase();
  if (proc.includes("notepad") || app.includes("notepad")) return "Notepad";
  if (proc.includes("textedit") || app.includes("textedit")) return "TextEdit";
  if (proc.includes("chrome") || app.includes("chrome")) return "Chrome";
  if (proc.includes("msedge") || app.includes("edge")) return "Edge";
  if (proc.includes("firefox") || app.includes("firefox")) return "Firefox";
  if (proc.includes("safari") || app.includes("safari")) return "Safari";
  if (proc.includes("explorer") || app.includes("file explorer")) return "Explorer";
  if (proc.includes("finder") || app.includes("finder")) return "Finder";
  if (proc.includes("terminal") || app.includes("terminal") || proc.includes("windowsterminal")) return "Terminal";
  return event.application || event.processName || undefined;
}

export function cleanLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/[:*]+$/g, "").trim() || undefined;
}

export function slugifyLabel(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || "text_input";
}
