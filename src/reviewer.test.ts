import * as core from "@actions/core";
import * as github from "@actions/github";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";
import { ReviewOptions } from "./reviewer.js";

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

describe("reviewer", () => {
  const reviewOptions: ReviewOptions = {
    githubToken: "test-token",
    diffMode: "last-commit",
    tokenLimit: 1234,
    changesThreshold: "error",
    reasoningEffort: "low",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock GitHubService methods
    vi.mocked(GitHubService.prototype.getEntirePRDiff).mockResolvedValue({
      commitMessage: "Test PR Title\n\nTest PR Body",
      patches: [{ filename: "pr.ts", patch: "pr diff" }],
    });

    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "test commit",
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
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
      reviewChanges: 0,
      reviewComments: 1,
      issueComments: 0,
    };

    // Setup service mocks
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue(
      mockAzureResponse
    );
    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue(
      mockGitHubResponse
    );

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify Azure OpenAI service was called
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalled();

    // Verify GitHub service was called
    expect(GitHubService.prototype.postReviewComments).toHaveBeenCalledWith(
      mockAzureResponse.comments,
      "error",
      undefined,
      [{ filename: "commit.ts", patch: "commit diff" }]
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

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify warning was logged
    expect(core.warning).toHaveBeenCalledWith(
      "No patches fit within token limit."
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

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify warning about skipped patches
    expect(core.warning).toHaveBeenCalledWith(
      "1 patches did not fit within tokenLimit = 1234."
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

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify services were not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No patches returned from GitHub.");
  });

  it("should handle empty AI response", async () => {
    // Mock isWithinTokenLimit to allow diff processing
    const { isWithinTokenLimit } = await import("gpt-tokenizer");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1000 // Return token count instead of boolean
    );

    // Mock successful diff retrieval
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "test commit",
      patches: [{ filename: "test.ts", patch: "test diff" }],
    });

    // Mock empty AI response
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [],
    });

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review({
      githubToken: "test-token",
      diffMode: "last-commit",
      tokenLimit: 1234,
      changesThreshold: "error",
      reasoningEffort: "low",
    });

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No suggestions from AI.");
    // Verify GitHub service was not called for posting comments
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();
  });

  it("should handle GitHub API errors", async () => {
    // Mock API error
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockRejectedValue(
      new Error("API Error")
    );

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify error was logged
    expect(core.error).toHaveBeenCalledWith(
      "Failed to get git info: API Error"
    );
  });

  it("should handle non-Error objects in getDiff error", async () => {
    // Mock GitHub service to throw a non-Error object
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockRejectedValue(42);

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    expect(core.error).toHaveBeenCalledWith("Failed to get git info: 42");
  });

  it("should handle entire-pr mode", async () => {
    // Mock diffMode input
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") {
        return "entire-pr";
      }
      return "";
    });

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review({
      ...reviewOptions,
      diffMode: "entire-pr",
    });

    // Verify entire-pr API was called
    expect(GitHubService.prototype.getEntirePRDiff).toHaveBeenCalled();
    expect(GitHubService.prototype.getLastCommitDiff).not.toHaveBeenCalled();
  });
});
