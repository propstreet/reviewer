import * as core from "@actions/core";
import { ReviewOptions } from "./reviewer.js";

// Mock types
type MockType = ReturnType<typeof vi.fn>;

// Mock dependencies
vi.mock("@actions/core");
vi.mock("./reviewer.js", () => ({
  review: vi.fn(),
}));

describe("index", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock core.getInput
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "azureOpenAIEndpoint":
          return "https://AZURE_ENDPOINT";
        case "azureOpenAIDeployment":
          return "AZURE_DEPLOYMENT";
        case "azureOpenAIKey":
          return "AZURE_API_KEY";
        case "azureOpenAIVersion":
          return "2024-12-01-preview";
        case "diffMode":
          return "last-push";
        case "severity":
          return "error";
        case "reasoningEffort":
          return "medium";
        case "tokenLimit":
          return "50000";
        case "commitLimit":
          return "100";
        default:
          return "";
      }
    });

    // Set GITHUB_TOKEN
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should call reviewer with default values when inputs are empty", async () => {
    // Mock all inputs to return empty string
    (core.getInput as MockType).mockImplementation(() => "");

    const { review } = await import("./reviewer.js");
    vi.mocked(review).mockImplementation((_options: ReviewOptions) =>
      Promise.resolve()
    );

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify reviewer was called with default values
    expect(review).toHaveBeenCalledExactlyOnceWith({
      githubToken: "test-token",
      diffMode: "last-push",
      tokenLimit: 50000,
      changesThreshold: "error",
      reasoningEffort: "medium",
      commitLimit: 100,
    });

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify completion was logged
    expect(core.info).toHaveBeenCalledExactlyOnceWith("Review completed.");
  });

  it("should call reviewer with provided values", async () => {
    // Mock inputs with specific values
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "diffMode":
          return "entire-pr";
        case "severity":
          return "warning";
        case "reasoningEffort":
          return "high";
        case "tokenLimit":
          return "150000";
        case "commitLimit":
          return "99";
        default:
          return "";
      }
    });

    const { review } = await import("./reviewer.js");
    vi.mocked(review).mockImplementation((_options: ReviewOptions) =>
      Promise.resolve()
    );

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify reviewer was called with provided values
    expect(review).toHaveBeenCalledExactlyOnceWith({
      githubToken: "test-token",
      diffMode: "entire-pr",
      tokenLimit: 150000,
      changesThreshold: "warning",
      reasoningEffort: "high",
      commitLimit: 99,
    });

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("should handle invalid diffMode", async () => {
    // Mock invalid diffMode
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") {
        return "invalid";
      }
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    // Verify error was reported
    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid diff mode: invalid"
    );
  });

  it("should handle invalid severity", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "invalid-severity";
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid severity: invalid-severity"
    );
  });

  it("should handle invalid reasoningEffort", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "invalid-effort";
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid reasoning effort: invalid-effort"
    );
  });

  it("should handle invalid tokenLimit", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "not-a-number";
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid token limit: not-a-number"
    );
  });

  it("should handle invalid commitLimit", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "200000";
      if (name === "commitLimit") return "not-a-number";
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid commit limit: not-a-number"
    );
  });

  it("should handle missing GITHUB_TOKEN", async () => {
    delete process.env.GITHUB_TOKEN;

    const { run } = await import("./index.js");
    await run();

    // Verify appropriate message was logged
    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Missing GITHUB_TOKEN in environment."
    );
  });

  it("should handle non-Error objects in catch", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "200000";
      return "";
    });

    const { review } = await import("./reviewer.js");
    vi.mocked(review).mockRejectedValue(42); // Throw a number instead of an Error

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "An unknown error occurred."
    );
  });

  it("should handle Error objects with message in catch", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "200000";
      return "";
    });

    const { review } = await import("./reviewer.js");
    vi.mocked(review).mockRejectedValue(new Error("Test error message")); // Throw an Error with message

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Test error message"
    );
  });
});
