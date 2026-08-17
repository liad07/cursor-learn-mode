import type { AnalysisPreview, LearnSession } from "../types.ts";

export interface WorkflowAnalyzer {
  analyze(session: LearnSession): AnalysisPreview | Promise<AnalysisPreview>;
}

export type WorkflowAnalyzerKind = "heuristic" | "llm" | "vision";
