export type LearnEventType =
  | "click"
  | "key"
  | "text"
  | "focus"
  | "window-change"
  | "app-change"
  | "clipboard"
  | "screenshot"
  | "narration";

export type UiElement = {
  name?: string;
  controlType?: string;
  automationId?: string;
  className?: string;
  isPassword?: boolean;
};

export type LearnEvent = {
  timestamp: string;
  type: LearnEventType;
  application?: string;
  processName?: string;
  windowTitle?: string;
  element?: UiElement;
  button?: "left" | "right" | "middle";
  key?: string;
  text?: string;
  modifiers?: string[];
  screenshot?: string;
  clipboardPreview?: string;
  x?: number;
  y?: number;
  redacted?: boolean;
};

export type ScreenshotRef = {
  path: string;
  timestamp: string;
  reason: string;
};

export type Demonstration = {
  id: string;
  startedAt: string;
  endedAt?: string;
  events: LearnEvent[];
  applications: string[];
  screenshots: ScreenshotRef[];
};

export type NarrationNote = {
  timestamp: string;
  text: string;
  source: "voice" | "typed";
};

export type LearnSession = {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  demonstrations: Demonstration[];
  narration: NarrationNote[];
};

export type WorkflowInput = {
  type: "string" | "number" | "boolean";
  required: boolean;
  example?: string;
  source?: string;
};

export type SemanticStep = {
  id: string;
  intent: string;
  application?: string;
  target?: string;
  inputKey?: string;
  constantValue?: string;
  kind:
    | "open-application"
    | "switch-application"
    | "type"
    | "click"
    | "shortcut"
    | "save"
    | "read"
    | "other";
};

export type Workflow = {
  name: string;
  title: string;
  description: string;
  version: number;
  inputs: Record<string, WorkflowInput>;
  applications: string[];
  steps: SemanticStep[];
  preconditions: string[];
  successConditions: string[];
  demonstrations: string[];
};

export type AnalysisPreview = {
  title: string;
  name: string;
  goal: string;
  applications: string[];
  inputs: Record<string, WorkflowInput>;
  steps: SemanticStep[];
  preconditions: string[];
  successConditions: string[];
  previewText: string;
};

export type ObserverStatus = {
  state: "starting" | "recording" | "paused" | "stopped" | "failed";
  error?: string;
  startedAt?: string;
  eventCount: number;
  elapsedMs: number;
};
