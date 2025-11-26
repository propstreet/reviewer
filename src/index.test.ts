import * as core from "@actions/core";
import * as github from "@actions/github";
import { ReviewService } from "./reviewer.js";
import { Context } from "@actions/github/lib/context.js";

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

  it("should require base and head sha", async () => {
    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify no errors were reported
    expect(core.setFailed).toHaveBeenCalledWith(
      "Missing base or head sha to review."
    );

    // Verify reviewer was not called
    expect(ReviewService.prototype.review).not.toHaveBeenCalled();
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
      backgroundPolling: undefined,
    });
  });

  it("should use base and head from synchronize event", async () => {
    // Mock github context payload
    vi.mocked(github).context.payload = {
      action: "synchronize",
      before: "base-sha",
      after: "head-sha",
    } as Context["payload"];

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
      backgroundPolling: undefined,
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
    } as Context["payload"];

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
      backgroundPolling: undefined,
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
      backgroundPolling: undefined,
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
});
