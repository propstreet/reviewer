export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export type SeverityLevel = "info" | "warning" | "error";

export function isValidReasoningEffort(
  reasoningEffort: string | null
): reasoningEffort is ReasoningEffort {
  return (
    reasoningEffort === null ||
    reasoningEffort === "minimal" ||
    reasoningEffort === "low" ||
    reasoningEffort === "medium" ||
    reasoningEffort === "high"
  );
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

export function isValidAzureEndpoint(endpoint: string): boolean {
  return endpoint.length > 0; // Add further validation if necessary
}

export function isValidAzureDeployment(deployment: string): boolean {
  return deployment.length > 0; // Add further validation if necessary
}

export function isValidAzureApiKey(apiKey: string): boolean {
  return apiKey.length > 0; // Add further validation if necessary
}

export function isValidAzureApiVersion(apiVersion: string): boolean {
  return apiVersion.length > 0; // Add further validation if necessary
}

export function isValidExcludePatterns(patterns: string): boolean {
  if (!patterns) return true; // Empty string is valid
  const patternList = patterns.split(",").map((p) => p.trim());
  return patternList.every((pattern) => {
    if (pattern.length === 0) return false;
    if (pattern.includes("..")) return false;
    if (pattern.startsWith("/")) return false;
    if (pattern.startsWith("~")) return false;
    return true;
  });
}
