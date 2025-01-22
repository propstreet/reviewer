import * as core from "@actions/core";

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
          return "last-commit";
        case "severity":
          return "error";
        case "reasoningEffort":
          return "medium";
        case "tokenLimit":
          return "200000";
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
  it("should call reviewer", async () => {
    const { review } = await import("./reviewer.js");
    vi.mocked(review).mockImplementation((_options: unknown) =>
      Promise.resolve()
    );

    // Verify token count is logged
    const infoSpy = vi.spyOn(core, "info");

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify reviewer was called
    expect(review).toHaveBeenCalled();

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify token count was logged correctly
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Review completed.")
    );
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
    expect(core.setFailed).toHaveBeenCalledWith("Invalid diff mode: invalid");
  });

  it("should handle invalid severity", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") return "last-commit";
      if (name === "severity") return "invalid-severity";
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
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

    expect(core.setFailed).toHaveBeenCalledWith(
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

    expect(core.setFailed).toHaveBeenCalledWith(
      "Invalid token limit: not-a-number"
    );
  });

  it("should handle missing GITHUB_TOKEN", async () => {
    delete process.env.GITHUB_TOKEN;

    const { run } = await import("./index.js");
    await run();

    // Verify appropriate message was logged
    expect(core.setFailed).toHaveBeenCalledWith(
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

    expect(core.setFailed).toHaveBeenCalledWith("An unknown error occurred.");
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

    expect(core.setFailed).toHaveBeenCalledWith("Test error message");
  });
});
