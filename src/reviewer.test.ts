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
//type MockType = ReturnType<typeof vi.fn>;

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
    commitLimit: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock GitHubService methods
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "test-sha",
      message: "test commit",
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      pull_number: 1,
      title: "test title",
      body: "test body",
      commitCount: 1,
      headSha: "head-sha",
      commits: [
        {
          sha: "head-sha",
        },
      ],
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
          sha: "test-sha",
          file: "test.ts",
          line: 1,
          side: "RIGHT" as const,
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
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalledWith(
      expect.stringMatching(/commit\.ts \(sha:\s+test-sha\).*commit diff/s),
      { reasoningEffort: "low" }
    );

    // Verify GitHub service was called
    expect(GitHubService.prototype.getPrDetails).toHaveBeenCalledWith("last");
    expect(GitHubService.prototype.postReviewComments).toHaveBeenCalledWith(
      mockAzureResponse.comments,
      "error",
      [
        {
          commit: {
            message: "test commit",
            patches: [
              {
                filename: "commit.ts",
                patch: "commit diff",
              },
            ],
            sha: "test-sha",
          },
          patches: [
            {
              filename: "commit.ts",
              patch: "commit diff",
            },
          ],
        },
      ]
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
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "test-sha",
      message: "test commit",
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
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "test-sha",
      message: "test commit",
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
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "test-sha",
      message: "",
      patches: [],
    });

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify services were not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");
  });

  it("should handle empty AI response", async () => {
    // Mock isWithinTokenLimit to allow diff processing
    const { isWithinTokenLimit } = await import("gpt-tokenizer");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1000 // Return token count instead of boolean
    );

    // Mock successful diff retrieval
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "test-sha",
      message: "test commit",
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
      commitLimit: 10,
    });

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No suggestions from AI.");
    // Verify GitHub service was not called for posting comments
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();
  });

  it("should handle GitHub API errors", async () => {
    // Mock API error
    vi.mocked(GitHubService.prototype.getCommitDetails).mockRejectedValue(
      new Error("API Error")
    );

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");

    await expect(async () => {
      await review(reviewOptions);
    }).rejects.toThrow("API Error");
  });

  it("should handle no PR commits", async () => {
    // Mock GitHubService to return empty commits
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      pull_number: 1,
      title: "test title",
      body: "test body",
      commitCount: 0,
      headSha: "head-sha",
      commits: [],
    });

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");
  });

  it("should use all commits for entire-pr diff mode", async () => {
    // Mock GitHubService to return multiple commits
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      pull_number: 1,
      title: "test title",
      body: "test body",
      commitCount: 3,
      headSha: "sha3",
      commits: [{ sha: "sha1" }, { sha: "sha2" }, { sha: "sha3" }],
    });

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review({
      ...reviewOptions,
      diffMode: "entire-pr",
    });

    // Verify all commits were used
    expect(GitHubService.prototype.getCommitDetails).toHaveBeenCalledTimes(3);
  });

  it("should warn if head sha was not in the loaded commits", async () => {
    // Mock GitHubService to return commits without head sha
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      pull_number: 1,
      title: "test title",
      body: "test body",
      commitCount: 1,
      headSha: "head-sha",
      commits: [{ sha: "sha1" }],
    });

    // Import and run the reviewer
    const { review } = await import("./reviewer.js");
    await review(reviewOptions);

    // Verify warning was logged
    expect(core.warning).toHaveBeenCalledWith(
      "PR head commit head-sha was not included in PR commits."
    );
  });
});
