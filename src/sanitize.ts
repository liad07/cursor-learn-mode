import type { Demonstration, LearnEvent, LearnSession } from "./types.ts";

const SENSITIVE_NAME =
  /\b(password|passwd|passcode|secret|token|authorization|api[-_ ]?key|session.?id|cookie|csrf|otp|ssn|credit.?card|cvv|private.?key)\b/i;

const SENSITIVE_TEXT =
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/g;

export function isSensitiveName(name: string | undefined): boolean {
  return Boolean(name && SENSITIVE_NAME.test(name));
}

export function redactText(value: string | undefined, fieldName?: string): { value: string; redacted: boolean } {
  if (value == null || value === "") return { value: value ?? "", redacted: false };
  if (isSensitiveName(fieldName)) return { value: "[REDACTED]", redacted: true };
  if (SENSITIVE_TEXT.test(value)) {
    SENSITIVE_TEXT.lastIndex = 0;
    return { value: value.replace(SENSITIVE_TEXT, "[REDACTED]"), redacted: true };
  }
  SENSITIVE_TEXT.lastIndex = 0;
  return { value, redacted: false };
}

export function sanitizeEvent(event: LearnEvent): LearnEvent {
  const field = event.element?.name ?? event.element?.automationId;
  const out: LearnEvent = { ...event, element: event.element ? { ...event.element } : undefined };
  if (out.element?.isPassword || isSensitiveName(field)) {
    if (out.text) out.text = "[REDACTED]";
    if (out.key) out.key = "[REDACTED]";
    if (out.clipboardPreview) out.clipboardPreview = "[REDACTED]";
    out.redacted = true;
    return out;
  }
  if (out.text) {
    const r = redactText(out.text, field);
    out.text = r.value;
    if (r.redacted) out.redacted = true;
  }
  if (out.clipboardPreview) {
    const r = redactText(out.clipboardPreview, field);
    out.clipboardPreview = r.value;
    if (r.redacted) out.redacted = true;
  }
  if (out.windowTitle) {
    const r = redactText(out.windowTitle);
    out.windowTitle = r.value;
    if (r.redacted) out.redacted = true;
  }
  return out;
}

export function sanitizeDemonstration(demo: Demonstration): Demonstration {
  return {
    ...demo,
    events: demo.events.map(sanitizeEvent),
  };
}

export function sanitizeSession(session: LearnSession): LearnSession {
  return {
    ...session,
    demonstrations: session.demonstrations.map(sanitizeDemonstration),
    narration: session.narration.map((note) => {
      const r = redactText(note.text);
      return { ...note, text: r.value };
    }),
  };
}

export function assertNoSecrets(text: string, label: string): void {
  const leaks = [
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /"password"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    /ghp_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
  ];
  for (const leak of leaks) {
    if (leak.test(text)) throw new Error(`Secret leak detected in ${label}`);
  }
}

export function stripDebugCoordinates(event: LearnEvent): LearnEvent {
  const { x: _x, y: _y, ...rest } = event;
  return rest;
}
