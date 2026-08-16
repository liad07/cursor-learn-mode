import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LEARN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CURSOR_HOME = path.join(os.homedir(), ".cursor");
export const SKILLS_DIR = path.join(CURSOR_HOME, "skills");
export const RECORDINGS_DIR = path.join(LEARN_ROOT, ".learn-recordings");
export const OBSERVER_DIR = path.join(LEARN_ROOT, "observer");
export const OBSERVER_EXE = path.join(OBSERVER_DIR, "dist", "LearnObserver.exe");
export const OBSERVER_MAC_DIR = path.join(LEARN_ROOT, "observer-mac");
export const OBSERVER_MAC = path.join(OBSERVER_MAC_DIR, "dist", "LearnObserver");
