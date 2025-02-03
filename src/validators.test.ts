import { describe, it, expect } from "vitest";
import { isValidExcludePatterns } from "./validators.js";

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
