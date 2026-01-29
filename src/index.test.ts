import * as core from "@actions/core";
import * as github from "@actions/github";
import { ReviewService } from "./reviewer.js";
import { SUPPORTED_ACTIONS } from "./constants.js";

// Use the context type from the main export (v9+ doesn't export Context class directly)
type GitHubContext = typeof github.context;

// Mock types
type MockType = ReturnType<typeof vi.fn>;

// Mock dependencies
vi.mock("@actions/core");
vi.mock("@actions/github");
vi.mock("./reviewer.js");

describe("index", () => {
  // Valid API key (16+ chars, no whitespace/control chars)
  const VALID_API_KEY = "test-azure-api-key-12345";

  const getInputDefaults = (name: string) => {
    switch (name) {
      case "azureOpenAIEndpoint":
        return "https://test.openai.azure.com";
      case "azureOpenAIDeployment":
        return "gpt-5";
      case "azureOpenAIKey":
        return VALID_API_KEY;
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
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock core.getInput
    (core.getInput as MockType).mockImplementation(getInputDefaults);

    // Set GITHUB_TOKEN
    process.env.GITHUB_TOKEN = "test-token";

    // Mock github context
    vi.mocked(github).context = {
      issue: {
        owner: "test-owner",
        repo: "test-repo",
        number: 1,
      },
      repo: {
        owner: "test-owner",
        repo: "test-repo",
      },
      payload: {},
      eventName: "pull_request",
      sha: "test-sha",
      ref: "refs/heads/main",
      workflow: "test-workflow",
      action: "test-action",
      actor: "test-actor",
      job: "test-job",
      runAttempt: 1,
      runNumber: 1,
      runId: 1,
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      graphqlUrl: "https://api.github.com/graphql",
    };
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("should require base and head sha with helpful error when no action detected", async () => {
    // Default payload is {}, so action is undefined
    const { run } = await import("./index.js");
    await run();

    // Verify setFailed called exactly once with all expected substrings
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    const errorMessage = vi.mocked(core.setFailed).mock.calls[0][0] as string;
    expect(errorMessage).toContain("Missing base or head sha to review.");
    expect(errorMessage).toContain("No action detected in payload.");
    expect(errorMessage).toContain("Supported auto-detection:");
    expect(errorMessage).toContain("provide explicit 'base' and 'head' inputs");

    // Verify reviewer was not called
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should show helpful error for unsupported action type", async () => {
    // Mock github context payload with unsupported action
    vi.mocked(github).context.payload = {
      action: "labeled",
    } as GitHubContext["payload"];

    const { run } = await import("./index.js");
    await run();

    // Verify setFailed called exactly once with all expected substrings
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    const errorMessage = vi.mocked(core.setFailed).mock.calls[0][0] as string;
    expect(errorMessage).toContain("Missing base or head sha to review.");
    expect(errorMessage).toContain("Detected action 'labeled'");
    expect(errorMessage).toContain("is not auto-detected");
    expect(errorMessage).toContain(SUPPORTED_ACTIONS.join(", "));

    // Verify reviewer was not called
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should show helpful error when only base is provided", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "base") return "some-base-sha";
      return getInputDefaults(name);
    });

    const { run } = await import("./index.js");
    await run();

    // Verify setFailed called exactly once with partial input message
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    const errorMessage = vi.mocked(core.setFailed).mock.calls[0][0] as string;
    expect(errorMessage).toContain("Missing base or head sha to review.");
    expect(errorMessage).toContain("Only 'base' was provided");
    expect(errorMessage).toContain("'head' is also required");
    expect(errorMessage).toContain(
      "Provide both 'base' and 'head', or omit both to use auto-detection"
    );

    // Verify reviewer was not called
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should show helpful error when only head is provided", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "head") return "some-head-sha";
      return getInputDefaults(name);
    });

    const { run } = await import("./index.js");
    await run();

    // Verify setFailed called exactly once with partial input message
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    const errorMessage = vi.mocked(core.setFailed).mock.calls[0][0] as string;
    expect(errorMessage).toContain("Missing base or head sha to review.");
    expect(errorMessage).toContain("Only 'head' was provided");
    expect(errorMessage).toContain("'base' is also required");

    // Verify reviewer was not called
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should show helpful error when supported action has missing payload SHAs", async () => {
    // Mock github context with supported action but missing pull_request SHAs
    vi.mocked(github).context.payload = {
      action: "opened",
      pull_request: {
        number: 1,
        // Missing base.sha and head.sha
      },
    } as GitHubContext["payload"];

    const { run } = await import("./index.js");
    await run();

    // Verify setFailed called exactly once with "should be supported" message
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    const errorMessage = vi.mocked(core.setFailed).mock.calls[0][0] as string;
    expect(errorMessage).toContain("Missing base or head sha to review.");
    expect(errorMessage).toContain("Detected action 'opened'");
    expect(errorMessage).toContain("should be supported");
    expect(errorMessage).toContain("payload is missing required SHA fields");

    // Verify reviewer was not called
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should treat whitespace-only base/head inputs as empty", async () => {
    // Mock github context with supported action
    vi.mocked(github).context.payload = {
      action: "opened",
      pull_request: {
        number: 1,
        base: { sha: "base-sha" },
        head: { sha: "head-sha" },
      },
    } as GitHubContext["payload"];

    // Whitespace-only inputs should be treated as empty and allow auto-detection
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "base") return "   ";
      if (name === "head") return "\t";
      return getInputDefaults(name);
    });

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    const { run } = await import("./index.js");
    await run();

    // Should succeed using auto-detected SHAs (not fail with partial input error)
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        base: "base-sha",
        head: "head-sha",
      })
    );
  });

  it("should use base and head from getInput", async () => {
    vi.mocked(github).context.payload = {};

    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        default:
          return getInputDefaults(name);
      }
    });

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify reviewer was called with provided values
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith({
      base: "base-sha",
      head: "head-sha",
      tokenLimit: 50000,
      changesThreshold: "error",
      reasoningEffort: "medium",
      commitLimit: 100,
      excludePatterns: [],
      customPrompt: undefined,
      backgroundPolling: undefined,
      skipMergeCommits: true,
    });
  });

  it("should use base and head from synchronize event", async () => {
    // Mock github context payload
    vi.mocked(github).context.payload = {
      action: "synchronize",
      before: "base-sha",
      after: "head-sha",
    } as GitHubContext["payload"];

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify reviewer was called with provided values
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith({
      base: "base-sha",
      head: "head-sha",
      tokenLimit: 50000,
      changesThreshold: "error",
      reasoningEffort: "medium",
      commitLimit: 100,
      excludePatterns: [],
      customPrompt: undefined,
      backgroundPolling: undefined,
      skipMergeCommits: true,
    });
  });

  it("should use base and head from pull_request event", async () => {
    // Mock github context payload
    vi.mocked(github).context.payload = {
      action: "opened",
      pull_request: {
        number: 1,
        base: { sha: "base-sha" },
        head: { sha: "head-sha" },
      },
    } as GitHubContext["payload"];

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify reviewer was called with provided values
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith({
      base: "base-sha",
      head: "head-sha",
      tokenLimit: 50000,
      changesThreshold: "error",
      reasoningEffort: "medium",
      commitLimit: 100,
      excludePatterns: [],
      customPrompt: undefined,
      backgroundPolling: undefined,
      skipMergeCommits: true,
    });
  });

  it("should use base and head from reopened event", async () => {
    // Mock github context payload
    vi.mocked(github).context.payload = {
      action: "reopened",
      pull_request: {
        number: 1,
        base: { sha: "base-sha" },
        head: { sha: "head-sha" },
      },
    } as GitHubContext["payload"];

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith({
      base: "base-sha",
      head: "head-sha",
      tokenLimit: 50000,
      changesThreshold: "error",
      reasoningEffort: "medium",
      commitLimit: 100,
      excludePatterns: [],
      customPrompt: undefined,
      backgroundPolling: undefined,
      skipMergeCommits: true,
    });
  });

  it("should use base and head from ready_for_review event", async () => {
    // Mock github context payload
    vi.mocked(github).context.payload = {
      action: "ready_for_review",
      pull_request: {
        number: 1,
        base: { sha: "base-sha" },
        head: { sha: "head-sha" },
      },
    } as GitHubContext["payload"];

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith({
      base: "base-sha",
      head: "head-sha",
      tokenLimit: 50000,
      changesThreshold: "error",
      reasoningEffort: "medium",
      commitLimit: 100,
      excludePatterns: [],
      customPrompt: undefined,
      backgroundPolling: undefined,
      skipMergeCommits: true,
    });
  });

  it("should call reviewer with provided values", async () => {
    // Mock inputs with specific values (using valid Azure config)
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "azureOpenAIEndpoint":
          return "https://custom.openai.azure.com";
        case "azureOpenAIDeployment":
          return "gpt-5-custom";
        case "azureOpenAIKey":
          return VALID_API_KEY;
        case "severity":
          return "warning";
        case "reasoningEffort":
          return "high";
        case "tokenLimit":
          return "150000";
        case "commitLimit":
          return "99";
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        default:
          return "";
      }
    });

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify reviewer was called with provided values
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith({
      base: "base-sha",
      head: "head-sha",
      tokenLimit: 150000,
      changesThreshold: "warning",
      reasoningEffort: "high",
      commitLimit: 99,
      excludePatterns: [],
      customPrompt: undefined,
      backgroundPolling: undefined,
      skipMergeCommits: true,
    });
  });

  it("should handle invalid severity", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
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

  it("should handle invalid Azure endpoint", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "50000";
      if (name === "commitLimit") return "100";
      if (name === "azureOpenAIEndpoint") return ""; // Empty endpoint
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid Azure OpenAI endpoint: "
    );
  });

  it("should handle invalid Azure deployment", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "50000";
      if (name === "commitLimit") return "100";
      if (name === "azureOpenAIEndpoint")
        return "https://test.openai.azure.com";
      if (name === "azureOpenAIDeployment") return ""; // Empty deployment
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid Azure OpenAI deployment: "
    );
  });

  it("should handle invalid Azure API key", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "severity") return "error";
      if (name === "reasoningEffort") return "medium";
      if (name === "tokenLimit") return "50000";
      if (name === "commitLimit") return "100";
      if (name === "azureOpenAIEndpoint")
        return "https://test.openai.azure.com";
      if (name === "azureOpenAIDeployment") return "gpt-5";
      if (name === "azureOpenAIKey") return ""; // Empty key
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid Azure OpenAI API key"
    );
  });

  it("should handle non-Error objects in catch", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        default:
          return getInputDefaults(name);
      }
    });

    vi.mocked(ReviewService.prototype.review).mockRejectedValue(42); // Throw a number instead of an Error

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "An unknown error occurred."
    );
  });

  it("should handle Error objects with message in catch", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        default:
          return getInputDefaults(name);
      }
    });

    vi.mocked(ReviewService.prototype.review).mockRejectedValue(
      new Error("Test error message")
    ); // Throw an Error with message

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Test error message"
    );
  });

  it("should construct backgroundPolling config when backgroundMode is enabled", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        case "backgroundMode":
          return "enabled";
        case "backgroundMaxWait":
          return "45";
        case "backgroundPollInterval":
          return "15";
        default:
          return getInputDefaults(name);
      }
    });

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backgroundPolling: {
          enabled: true,
          maxWaitTimeMs: 45 * 60 * 1000, // 45 minutes in ms
          initialIntervalMs: 15 * 1000, // 15 seconds in ms
          maxIntervalMs: 30 * 1000, // 30 seconds cap
          backoffMultiplier: 1.5,
        },
      })
    );
  });

  it("should not validate background params when backgroundMode is disabled", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        case "backgroundMode":
          return "disabled";
        case "backgroundMaxWait":
          return "invalid"; // Invalid but should not matter
        case "backgroundPollInterval":
          return "invalid"; // Invalid but should not matter
        default:
          return getInputDefaults(name);
      }
    });

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    const { run } = await import("./index.js");
    await run();

    // Should not fail because backgroundMode is disabled
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backgroundPolling: undefined,
      })
    );
  });

  it("should fail on invalid backgroundMode", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "backgroundMode") return "invalid";
      return getInputDefaults(name);
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid backgroundMode: invalid. Must be 'enabled' or 'disabled'."
    );
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should fail on invalid backgroundMaxWait when enabled", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "backgroundMode":
          return "enabled";
        case "backgroundMaxWait":
          return "999"; // Out of range (1-60)
        default:
          return getInputDefaults(name);
      }
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid backgroundMaxWait: 999. Must be 1-60 minutes."
    );
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should fail on invalid backgroundPollInterval when enabled", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "backgroundMode":
          return "enabled";
        case "backgroundMaxWait":
          return "30";
        case "backgroundPollInterval":
          return "1"; // Out of range (5-60)
        default:
          return getInputDefaults(name);
      }
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid backgroundPollInterval: 1. Must be 5-60 seconds."
    );
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should fail on invalid skipMergeCommits", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "skipMergeCommits") return "invalid";
      return getInputDefaults(name);
    });

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).toHaveBeenCalledExactlyOnceWith(
      "Invalid skipMergeCommits: invalid. Must be 'true' or 'false'."
    );
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
  });

  it("should pass skipMergeCommits=false to reviewer", async () => {
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "base":
          return "base-sha";
        case "head":
          return "head-sha";
        case "skipMergeCommits":
          return "false";
        default:
          return getInputDefaults(name);
      }
    });

    vi.mocked(ReviewService.prototype.review).mockResolvedValue(true);

    const { run } = await import("./index.js");
    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(ReviewService.prototype.review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        skipMergeCommits: false,
      })
    );
  });
});
