/** Valid reasoning effort levels for AI models */
const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type SeverityLevel = "info" | "warning" | "error";

export type BackgroundMode = "enabled" | "disabled";

// ============================================================================
// Validation Constants
// ============================================================================

/** Maximum length for custom prompt in characters */
export const MAX_CUSTOM_PROMPT_LENGTH = 1000;

/** Maximum number of commits to review */
export const MAX_COMMIT_LIMIT = 100;

/** Background mode wait time limits in minutes */
export const BACKGROUND_MAX_WAIT_MIN = 1;
export const BACKGROUND_MAX_WAIT_MAX = 60;

/** Background mode poll interval limits in seconds */
export const BACKGROUND_POLL_INTERVAL_MIN = 5;
export const BACKGROUND_POLL_INTERVAL_MAX = 60;

/** Background mode polling defaults */
export const BACKGROUND_MAX_INTERVAL_MS = 30 * 1000; // 30 seconds cap
export const BACKGROUND_BACKOFF_MULTIPLIER = 1.5;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a string as a positive integer within an optional range.
 * @returns The parsed number or null if invalid
 */
function parseIntInRange(
  value: string,
  min?: number,
  max?: number
): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num)) return null;
  if (min !== undefined && num < min) return null;
  if (max !== undefined && num > max) return null;
  return num;
}

/**
 * Format an error for logging, safely extracting message from Error objects.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ============================================================================
// Enum Validators
// ============================================================================

export function isValidReasoningEffort(
  reasoningEffort: string
): reasoningEffort is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(reasoningEffort);
}

export function isValidSeverityLevel(
  severity: string
): severity is SeverityLevel {
  return ["info", "warning", "error"].includes(severity);
}

export function isValidBackgroundMode(mode: string): mode is BackgroundMode {
  return ["enabled", "disabled"].includes(mode);
}

export function isValidBooleanInput(value: string): boolean {
  return ["true", "false"].includes(value.toLowerCase());
}

export function parseBooleanInput(
  value: string,
  defaultValue: boolean
): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === "true";
}

// ============================================================================
// Numeric Validators
// ============================================================================

export function isValidTokenLimit(limit: string): boolean {
  return parseIntInRange(limit, 1) !== null;
}

export function isValidCommitLimit(limit: string): boolean {
  return parseIntInRange(limit, 1, MAX_COMMIT_LIMIT) !== null;
}

export function isValidBackgroundMaxWait(maxWait: string): boolean {
  return (
    parseIntInRange(
      maxWait,
      BACKGROUND_MAX_WAIT_MIN,
      BACKGROUND_MAX_WAIT_MAX
    ) !== null
  );
}

export function isValidBackgroundPollInterval(interval: string): boolean {
  return (
    parseIntInRange(
      interval,
      BACKGROUND_POLL_INTERVAL_MIN,
      BACKGROUND_POLL_INTERVAL_MAX
    ) !== null
  );
}

// ============================================================================
// Azure Configuration Validators (Security Hardened)
// ============================================================================

/**
 * Validates Azure OpenAI endpoint URL.
 * Must be a valid HTTP/HTTPS URL with a hostname.
 */
export function isValidAzureEndpoint(endpoint: string): boolean {
  if (!endpoint || endpoint.length === 0) return false;

  try {
    const url = new URL(endpoint);
    // Must be HTTP or HTTPS
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    // Must have a valid hostname
    if (!url.hostname || url.hostname.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates Azure OpenAI deployment name.
 * Azure allows: alphanumerics, underscores, parentheses, hyphens, periods.
 * Length: 1-64 characters.
 */
export function isValidAzureDeployment(deployment: string): boolean {
  if (!deployment || deployment.length === 0) return false;
  if (deployment.length > 64) return false;
  // Azure deployment names: alphanumeric, hyphens, underscores, dots, parentheses
  return /^[a-zA-Z0-9][a-zA-Z0-9._()-]*$/.test(deployment);
}

/**
 * Validates Azure OpenAI API key.
 * Ensures the key is non-empty and has reasonable length.
 * Note: We don't enforce specific format as Azure key formats may vary.
 */
export function isValidAzureApiKey(apiKey: string): boolean {
  if (!apiKey || apiKey.length === 0) return false;
  // Minimum length to catch obvious mistakes, but don't over-constrain format
  if (apiKey.length < 16) return false;
  // Reject keys with whitespace or control characters (ASCII 0-31)
  for (const char of apiKey) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || /\s/.test(char)) return false;
  }
  return true;
}

// ============================================================================
// Pattern Validators (Security Hardened)
// ============================================================================

/**
 * Validates file exclusion patterns.
 * Prevents path traversal and absolute path attacks.
 */
export function isValidExcludePatterns(patterns: string): boolean {
  if (!patterns) return true; // Empty string is valid
  const patternList = patterns.split(",").map((p) => p.trim());
  return patternList.every((pattern) => {
    if (pattern.length === 0) return false;
    // Path traversal prevention
    if (pattern.includes("..")) return false;
    // Absolute path prevention
    if (pattern.startsWith("/")) return false;
    // Home directory expansion prevention
    if (pattern.startsWith("~")) return false;
    // Null byte injection prevention
    if (pattern.includes("\0")) return false;
    return true;
  });
}

/**
 * Validates custom prompt input.
 * Enforces length limit to prevent prompt injection at scale.
 */
export function isValidCustomPrompt(prompt: string): boolean {
  if (!prompt) return true; // Empty string is valid (optional parameter)
  // Enforce reasonable length limit
  return prompt.length > 0 && prompt.length <= MAX_CUSTOM_PROMPT_LENGTH;
}
