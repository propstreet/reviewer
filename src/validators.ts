import { ChatCompletionReasoningEffort } from "openai/resources/index.mjs";

export type SeverityLevel = "info" | "warning" | "error";
export type DiffMode = "last-commit" | "entire-pr";

export function isValidReasoningEffort(
  reasoningEffort: string): reasoningEffort is ChatCompletionReasoningEffort {
  return ["low", "medium", "high"].includes(reasoningEffort);
}

export function isValidSeverityLevel(severity: string): severity is SeverityLevel {
  return ["info", "warning", "error"].includes(severity);
}

export function isValidDiffMode(diffMode: string): diffMode is DiffMode {
  return ["last-commit", "entire-pr"].includes(diffMode);
}
