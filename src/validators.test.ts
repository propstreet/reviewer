import { describe, it, expect } from "vitest";
import { isValidExcludePatterns, isValidCustomPrompt } from "./validators.js";

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

describe("isValidCustomPrompt", () => {
  it("should accept empty string", () => {
    expect(isValidCustomPrompt("")).toBe(true);
  });

  it("should accept undefined", () => {
    expect(isValidCustomPrompt(undefined as unknown as string)).toBe(true);
  });

  it("should accept valid prompts", () => {
    expect(isValidCustomPrompt("Focus on security")).toBe(true);
    expect(isValidCustomPrompt("A".repeat(1000))).toBe(true);
  });

  it("should reject too long prompts", () => {
    expect(isValidCustomPrompt("A".repeat(1001))).toBe(false);
  });
});
