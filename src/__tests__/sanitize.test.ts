import { redactText, sanitizeEvent, assertNoSecrets } from "../sanitize.ts";
import type { LearnEvent } from "../types.ts";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const passwordEvent: LearnEvent = {
  timestamp: "2026-08-14T10:00:00.000Z",
  type: "text",
  text: "hunter2",
  element: { name: "Password", isPassword: true },
};

const tokenEvent: LearnEvent = {
  timestamp: "2026-08-14T10:00:01.000Z",
  type: "clipboard",
  clipboardPreview: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
};

const clean = sanitizeEvent(passwordEvent);
assert(clean.text === "[REDACTED]", "password text must be redacted");
assert(clean.redacted === true, "password event marked redacted");

const token = sanitizeEvent(tokenEvent);
assert(token.clipboardPreview?.includes("[REDACTED]"), "bearer token must be redacted");

const r = redactText("hello", "username");
assert(r.value === "hello" && r.redacted === false, "normal text stays");

assertNoSecrets("no secrets here", "ok");
let threw = false;
try {
  assertNoSecrets('Bearer abcdefghijklmnop', "skill");
} catch {
  threw = true;
}
assert(threw, "assertNoSecrets must catch bearer tokens");

threw = false;
try {
  assertNoSecrets("ghp_abcdefghijklmnopqrstuvwxyz0123456789", "skill");
} catch {
  threw = true;
}
assert(threw, "assertNoSecrets must catch GitHub PATs");

console.log("sanitize.test.ts ok");
