import { ChatCompletionReasoningEffort } from "openai/resources/index.mjs";

export type SeverityLevel = "info" | "warning" | "error";

export function isValidReasoningEffort(
  reasoningEffort: string
): reasoningEffort is ChatCompletionReasoningEffort {
  return ["low", "medium", "high"].includes(reasoningEffort);
}

export function isValidSeverityLevel(
  severity: string
): severity is SeverityLevel {
  return ["info", "warning", "error"].includes(severity);
}

export function isValidTokenLimit(limit: string): boolean {
  const num = parseInt(limit, 10);
  return !isNaN(num) && num > 0;
}

export function isValidCommitLimit(limit: string): boolean {
  const num = parseInt(limit, 10);
  return !isNaN(num) && num > 0 && num <= 100;
}
