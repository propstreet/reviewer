import { describe, it, expect } from "vitest";
import {
  isValidExcludePatterns,
  isValidCustomPrompt,
  isValidAzureEndpoint,
  isValidAzureDeployment,
  isValidAzureApiKey,
} from "./validators.js";

describe("isValidAzureEndpoint", () => {
  it("should accept non-empty endpoints", () => {
    expect(isValidAzureEndpoint("https://my-resource.openai.azure.com")).toBe(
      true
    );
  });

  it("should reject empty endpoints", () => {
    expect(isValidAzureEndpoint("")).toBe(false);
  });
});

describe("isValidAzureDeployment", () => {
  it("should accept non-empty deployments", () => {
    expect(isValidAzureDeployment("gpt-5")).toBe(true);
  });

  it("should reject empty deployments", () => {
    expect(isValidAzureDeployment("")).toBe(false);
  });
});

describe("isValidAzureApiKey", () => {
  it("should accept non-empty keys", () => {
    expect(isValidAzureApiKey("some-api-key")).toBe(true);
  });

  it("should reject empty keys", () => {
    expect(isValidAzureApiKey("")).toBe(false);
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
