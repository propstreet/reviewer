import { describe, it, expect } from "vitest";
import {
  isValidExcludePatterns,
  isValidCustomPrompt,
  isValidAzureEndpoint,
  isValidAzureDeployment,
  isValidAzureApiKey,
  isValidBackgroundMode,
  isValidBackgroundMaxWait,
  isValidBackgroundPollInterval,
  isValidBooleanInput,
  parseBooleanInput,
} from "./validators.js";

describe("isValidAzureEndpoint", () => {
  it("should accept valid HTTPS Azure endpoints", () => {
    expect(isValidAzureEndpoint("https://my-resource.openai.azure.com")).toBe(
      true
    );
    expect(isValidAzureEndpoint("https://test.openai.azure.com/")).toBe(true);
  });

  it("should accept HTTP endpoints (for local proxies)", () => {
    expect(isValidAzureEndpoint("http://my-resource.openai.azure.com")).toBe(
      true
    );
  });

  it("should accept localhost (for local proxies/testing)", () => {
    expect(isValidAzureEndpoint("https://localhost")).toBe(true);
    expect(isValidAzureEndpoint("http://localhost:8080")).toBe(true);
    expect(isValidAzureEndpoint("http://127.0.0.1:3000")).toBe(true);
  });

  it("should reject empty endpoints", () => {
    expect(isValidAzureEndpoint("")).toBe(false);
  });

  it("should reject invalid URLs", () => {
    expect(isValidAzureEndpoint("not-a-url")).toBe(false);
    expect(isValidAzureEndpoint("ftp://example.com")).toBe(false);
  });
});

describe("isValidAzureDeployment", () => {
  it("should accept valid deployment names", () => {
    expect(isValidAzureDeployment("gpt-5")).toBe(true);
    expect(isValidAzureDeployment("gpt-5-codex")).toBe(true);
    expect(isValidAzureDeployment("my_deployment")).toBe(true);
    expect(isValidAzureDeployment("model.v1")).toBe(true);
    expect(isValidAzureDeployment("gpt4(preview)")).toBe(true); // Azure allows parentheses
  });

  it("should reject empty deployments", () => {
    expect(isValidAzureDeployment("")).toBe(false);
  });

  it("should reject deployments over 64 chars", () => {
    expect(isValidAzureDeployment("a".repeat(65))).toBe(false);
    expect(isValidAzureDeployment("a".repeat(64))).toBe(true);
  });

  it("should reject deployments starting with non-alphanumeric", () => {
    expect(isValidAzureDeployment("-gpt5")).toBe(false);
    expect(isValidAzureDeployment("_gpt5")).toBe(false);
    expect(isValidAzureDeployment(".gpt5")).toBe(false);
  });
});

describe("isValidAzureApiKey", () => {
  it("should accept valid API keys", () => {
    // Various formats Azure might use
    expect(isValidAzureApiKey("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidAzureApiKey("some-api-key-with-dashes-12345")).toBe(true);
    expect(isValidAzureApiKey("sk-proj-abc123def456")).toBe(true);
  });

  it("should accept long keys", () => {
    const longKey = "a".repeat(156); // OpenAI project keys can be this long
    expect(isValidAzureApiKey(longKey)).toBe(true);
  });

  it("should reject empty keys", () => {
    expect(isValidAzureApiKey("")).toBe(false);
  });

  it("should reject keys shorter than 16 chars", () => {
    expect(isValidAzureApiKey("short")).toBe(false);
    expect(isValidAzureApiKey("a".repeat(15))).toBe(false);
  });

  it("should accept keys with exactly 16 chars", () => {
    expect(isValidAzureApiKey("a".repeat(16))).toBe(true);
  });

  it("should reject keys with whitespace", () => {
    expect(isValidAzureApiKey("key with spaces here")).toBe(false);
    expect(isValidAzureApiKey("key\twith\ttabs")).toBe(false);
    expect(isValidAzureApiKey("key\nwith\nnewlines")).toBe(false);
  });

  it("should reject keys with control characters", () => {
    expect(isValidAzureApiKey("key\x00with\x00nulls")).toBe(false);
  });
});

describe("isValidCustomPrompt", () => {
  it("should accept empty string", () => {
    expect(isValidCustomPrompt("")).toBe(true);
  });

  it("should accept valid prompts", () => {
    expect(isValidCustomPrompt("Focus on security issues")).toBe(true);
  });

  it("should reject prompts over 1000 characters", () => {
    const longPrompt = "a".repeat(1001);
    expect(isValidCustomPrompt(longPrompt)).toBe(false);
  });

  it("should accept prompts exactly 1000 characters", () => {
    const maxPrompt = "a".repeat(1000);
    expect(isValidCustomPrompt(maxPrompt)).toBe(true);
  });
});

describe("isValidExcludePatterns", () => {
  it("should accept empty string", () => {
    expect(isValidExcludePatterns("")).toBe(true);
  });

  it("should accept valid patterns", () => {
    expect(isValidExcludePatterns("*.test.ts,dist/**/*")).toBe(true);
    expect(isValidExcludePatterns("*.md, docs/*, test/**/*.ts")).toBe(true);
    expect(isValidExcludePatterns("node_modules")).toBe(true);
  });

  it("should reject invalid patterns", () => {
    expect(isValidExcludePatterns("../test.ts")).toBe(false);
    expect(isValidExcludePatterns("../../*")).toBe(false);
    expect(isValidExcludePatterns("/etc/passwd")).toBe(false);
  });

  it("should handle whitespace", () => {
    expect(isValidExcludePatterns(" *.test.ts , dist/**/* ")).toBe(true);
  });
});

describe("isValidBackgroundMode", () => {
  it("should accept 'enabled'", () => {
    expect(isValidBackgroundMode("enabled")).toBe(true);
  });

  it("should accept 'disabled'", () => {
    expect(isValidBackgroundMode("disabled")).toBe(true);
  });

  it("should reject invalid modes", () => {
    expect(isValidBackgroundMode("auto")).toBe(false);
    expect(isValidBackgroundMode("true")).toBe(false);
    expect(isValidBackgroundMode("")).toBe(false);
    expect(isValidBackgroundMode("ENABLED")).toBe(false);
  });
});

describe("isValidBackgroundMaxWait", () => {
  it("should accept valid wait times (1-60)", () => {
    expect(isValidBackgroundMaxWait("1")).toBe(true);
    expect(isValidBackgroundMaxWait("30")).toBe(true);
    expect(isValidBackgroundMaxWait("60")).toBe(true);
  });

  it("should reject wait times below 1", () => {
    expect(isValidBackgroundMaxWait("0")).toBe(false);
    expect(isValidBackgroundMaxWait("-1")).toBe(false);
  });

  it("should reject wait times above 60", () => {
    expect(isValidBackgroundMaxWait("61")).toBe(false);
    expect(isValidBackgroundMaxWait("100")).toBe(false);
  });

  it("should reject non-numeric values", () => {
    expect(isValidBackgroundMaxWait("abc")).toBe(false);
    expect(isValidBackgroundMaxWait("")).toBe(false);
  });
});

describe("isValidBackgroundPollInterval", () => {
  it("should accept valid intervals (5-60)", () => {
    expect(isValidBackgroundPollInterval("5")).toBe(true);
    expect(isValidBackgroundPollInterval("10")).toBe(true);
    expect(isValidBackgroundPollInterval("60")).toBe(true);
  });

  it("should reject intervals below 5", () => {
    expect(isValidBackgroundPollInterval("0")).toBe(false);
    expect(isValidBackgroundPollInterval("4")).toBe(false);
  });

  it("should reject intervals above 60", () => {
    expect(isValidBackgroundPollInterval("61")).toBe(false);
    expect(isValidBackgroundPollInterval("120")).toBe(false);
  });

  it("should reject non-numeric values", () => {
    expect(isValidBackgroundPollInterval("abc")).toBe(false);
    expect(isValidBackgroundPollInterval("")).toBe(false);
  });
});

describe("isValidBooleanInput", () => {
  it("should accept 'true' and 'false'", () => {
    expect(isValidBooleanInput("true")).toBe(true);
    expect(isValidBooleanInput("false")).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(isValidBooleanInput("True")).toBe(true);
    expect(isValidBooleanInput("FALSE")).toBe(true);
    expect(isValidBooleanInput("TrUe")).toBe(true);
  });

  it("should reject other values", () => {
    expect(isValidBooleanInput("yes")).toBe(false);
    expect(isValidBooleanInput("no")).toBe(false);
    expect(isValidBooleanInput("1")).toBe(false);
    expect(isValidBooleanInput("0")).toBe(false);
    expect(isValidBooleanInput("")).toBe(false);
  });
});

describe("parseBooleanInput", () => {
  it("should parse 'true' as true", () => {
    expect(parseBooleanInput("true", false)).toBe(true);
    expect(parseBooleanInput("True", false)).toBe(true);
    expect(parseBooleanInput("TRUE", false)).toBe(true);
  });

  it("should parse 'false' as false", () => {
    expect(parseBooleanInput("false", true)).toBe(false);
    expect(parseBooleanInput("False", true)).toBe(false);
    expect(parseBooleanInput("FALSE", true)).toBe(false);
  });

  it("should return default for empty string", () => {
    expect(parseBooleanInput("", true)).toBe(true);
    expect(parseBooleanInput("", false)).toBe(false);
  });
});
