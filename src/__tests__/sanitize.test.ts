import { redactText, sanitizeEvent, assertNoSecrets, isSensitiveName } from "../sanitize.ts";
import { compressEvents } from "../analysis/compress.ts";
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

assert(!isSensitiveName("Passenger"), "passenger is not a secret field");
assert(isSensitiveName("Password"), "password field is sensitive");
assert(isSensitiveName("API key"), "api key field is sensitive");

const redactedType: LearnEvent = {
  timestamp: "t0",
  type: "text",
  text: "[REDACTED]",
  redacted: true,
  element: { name: "Password", isPassword: true },
};
const redactedSteps = compressEvents([
  { timestamp: "t0", type: "app-change", application: "Chrome", processName: "chrome", windowTitle: "Login" },
  redactedType,
]);
assert(!redactedSteps.some((s) => s.kind === "type"), "redacted typing must not become a type step");

console.log("sanitize.test.ts ok");
