import * as core from "@actions/core";
import * as github from "@actions/github";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";

type Context = {
  payload: Record<string, unknown>;
  eventName: string;
  sha: string;
  ref: string;
  workflow: string;
  action: string;
  actor: string;
  job: string;
  runNumber: number;
  runId: number;
  apiUrl: string;
  serverUrl: string;
  graphqlUrl: string;
  issue: { owner: string; repo: string; number: number };
  repo: { owner: string; repo: string };
};

// Mock types
type MockType = ReturnType<typeof vi.fn>;

// Mock dependencies
vi.mock("@actions/core");
vi.mock("@actions/github");
vi.mock("./azureOpenAIService.js");
vi.mock("./githubService.js");
vi.mock("gpt-tokenizer", () => ({
  isWithinTokenLimit: vi.fn(),
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
          return "info";
        case "reasoningEffort":
          return "medium";
        case "tokenLimit":
          return "200000";
        default:
          return "";
      }
    });

    // Mock GitHubService methods
    vi.mocked(GitHubService.prototype.getEntirePRDiff).mockResolvedValue({
      commitMessage: "Test PR Title\n\nTest PR Body",
      patches: [{ filename: "test.ts", patch: "test diff" }],
    });

    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "test commit",
      patches: [{ filename: "test.ts", patch: "test diff" }],
    });

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
      runNumber: 1,
      runId: 1,
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      graphqlUrl: "https://api.github.com/graphql",
    } as Context;

    // Set GITHUB_TOKEN
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should handle successful review flow", async () => {
    // Mock isWithinTokenLimit to allow diff processing and return token count
    const { isWithinTokenLimit } = await import("gpt-tokenizer");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234 // Return specific token count for verification
    );

    // Verify token count is logged
    const infoSpy = vi.spyOn(core, "info");

    // Mock Azure OpenAI response
    const mockAzureResponse = {
      comments: [
        {
          file: "test.ts",
          line: 1,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    };

    // Mock GitHub response
    const mockGitHubResponse = {
      skipped: false,
      commentsPosted: 1,
      commentsFiltered: 0,
    };

    // Setup service mocks
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue(
      mockAzureResponse
    );
    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue(
      mockGitHubResponse
    );

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify Azure OpenAI service was called
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalled();

    // Verify GitHub service was called
    expect(GitHubService.prototype.postReviewComments).toHaveBeenCalledWith(
      mockAzureResponse.comments,
      "info"
    );

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();

    // Verify token count was logged correctly
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Token Count: 1234")
    );
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should handle patches exceeding token limit", async () => {
    // Mock isWithinTokenLimit to simulate token limit exceeded
    const { isWithinTokenLimit } = await import("gpt-tokenizer");

    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => {
        // Simulate first patch being too large
        return false; // Return false when exceeding token limit
      }
    );

    // Mock GitHubService to return some patches
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "test commit",
      patches: [{ filename: "large.ts", patch: "very large diff" }],
    });

    const { run } = await import("./index.js");
    await run();

    // Verify warning was logged
    expect(core.warning).toHaveBeenCalledWith(
      "First patch (large.ts) is too large, skipping AI completion."
    );
    // Verify Azure OpenAI service was not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should handle some patches within token limit", async () => {
    // Mock isWithinTokenLimit to simulate selective patch inclusion
    const { isWithinTokenLimit } = await import("gpt-tokenizer");
    const infoSpy = vi.spyOn(core, "info");

    vi.mocked(isWithinTokenLimit).mockImplementation(
      (input: unknown, _tokenLimit: number) => {
        // Accept first two patches, reject the third
        if (typeof input === "string" && input.includes("large.ts")) {
          return false;
        }
        // Return specific token count for final diff verification
        if (
          typeof input === "string" &&
          input.includes("small1.ts") &&
          input.includes("small2.ts")
        ) {
          return 5678; // Return token count for final combined diff
        }
        return 1000; // Return token count for individual patch checks
      }
    );

    // Mock GitHubService to return multiple patches
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "test commit",
      patches: [
        { filename: "small1.ts", patch: "small diff 1" },
        { filename: "small2.ts", patch: "small diff 2" },
        { filename: "large.ts", patch: "very large diff" },
      ],
    });

    const { run } = await import("./index.js");
    await run();

    // Verify warning about skipped patches
    expect(core.warning).toHaveBeenCalledWith(
      "1 patches did not fit within tokenLimit = 200000."
    );
    // Verify Azure OpenAI service was called (since some patches fit)
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalled();

    // Verify token count was logged correctly for final diff
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Token Count: 5678")
    );
  });

  it("should handle no diff found", async () => {
    // Mock GitHubService to return empty patches
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "",
      patches: [],
    });
    vi.mocked(GitHubService.prototype.getEntirePRDiff).mockResolvedValue({
      commitMessage: "",
      patches: [],
    });

    const { run } = await import("./index.js");
    await run();

    // Verify services were not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No patches returned from GitHub.");
  });

  it("should handle invalid inputs", async () => {
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

  it("should handle missing GITHUB_TOKEN", async () => {
    delete process.env.GITHUB_TOKEN;

    const { run } = await import("./index.js");
    await run();

    // Verify appropriate message was logged
    expect(core.setFailed).toHaveBeenCalledWith(
      "Missing GITHUB_TOKEN in environment."
    );
  });

  it("should handle GitHub API errors", async () => {
    // Mock API error
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockRejectedValue(
      new Error("API Error")
    );

    const { run } = await import("./index.js");
    await run();

    // Verify error was logged
    expect(core.error).toHaveBeenCalledWith(
      "Failed to get git info: API Error"
    );
  });

  it("should handle entire-pr mode", async () => {
    // Mock diffMode input
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") {
        return "entire-pr";
      }
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    // Verify entire-pr API was called
    expect(GitHubService.prototype.getEntirePRDiff).toHaveBeenCalled();
    expect(GitHubService.prototype.getLastCommitDiff).not.toHaveBeenCalled();
  });
});
