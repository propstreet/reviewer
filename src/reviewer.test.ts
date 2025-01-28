import * as core from "@actions/core";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";
import { ReviewService, ReviewOptions } from "./reviewer.js";

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
    tokenLimit: 1234,
    changesThreshold: "error",
    reasoningEffort: "low",
    commitLimit: 10,
    base: "base-sha",
    head: "head-sha",
  };

  const mockedGithubService = new GitHubService({
    token: "test-token",
    owner: "test-owner",
    repo: "test-repo",
    pullNumber: 1,
  });

  const mockedAzureService = new AzureOpenAIService({
    apiKey: "test-key",
    apiVersion: "test-version",
    deployment: "test-deployment",
    endpoint: "test-endpoint",
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock GitHubService methods
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "test-sha",
          message: "test commit",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    vi.mocked(GitHubService.prototype.getPrDetails).mockImplementation(
      async () => {
        return {
          number: 1,
          title: "test title",
          body: "test body",
          commitCount: 1,
          head: "head-sha",
          base: "base-sha",
        };
      }
    );
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
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "test-sha",
      message: "test commit",
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

    // Verify Azure OpenAI service was called
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalledWith(
      `# test title

test body

## COMMIT SHA: test-sha

test commit

### FILE: commit.ts

\`\`\`diff
commit diff
\`\`\`
`,
      { reasoningEffort: "low" }
    );

    // Verify GitHub service was called
    expect(GitHubService.prototype.getPrDetails).toHaveBeenCalled();
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

    // Verify success message was logged
    expect(core.info).toHaveBeenCalledWith(
      "Posted 1 review comments, requested 0 changes and wrote 0 issue comments."
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
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

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

    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "test commit",
      patches: [
        { filename: "small1.ts", patch: "small diff 1" },
        { filename: "small2.ts", patch: "small diff 2" },
        { filename: "large.ts", patch: "very large diff" },
      ],
    });

    // Mock GitHubService to return multiple patches
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "head-sha",
          message: "test commit",
          patches: [
            { filename: "small1.ts", patch: "small diff 1" },
            { filename: "small2.ts", patch: "small diff 2" },
            { filename: "large.ts", patch: "very large diff" },
          ],
        },
      ],
      patches: [
        { filename: "small1.ts", patch: "small diff 1" },
        { filename: "small2.ts", patch: "small diff 2" },
        { filename: "large.ts", patch: "very large diff" },
      ],
    });

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

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
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [],
      patches: [],
    });

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

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
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "test-sha",
          message: "test commit",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    // Mock empty AI response
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [],
    });

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review({
      tokenLimit: 1234,
      changesThreshold: "error",
      reasoningEffort: "low",
      commitLimit: 10,
      base: "base-sha",
      head: "head-sha",
    });

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No suggestions from AI.");
    // Verify GitHub service was not called for posting comments
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();
  });

  it("should handle GitHub API errors", async () => {
    // Mock API error
    vi.mocked(GitHubService.prototype.getPrDetails).mockRejectedValue(
      new Error("API Error")
    );

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );

    await expect(async () => {
      await reviewService.review(reviewOptions);
    }).rejects.toThrow("API Error");
  });

  it("should handle no PR commits", async () => {
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      number: 1,
      title: "test title",
      body: "test body",
      commitCount: 0,
      head: "head-sha",
      base: "base-sha",
    });

    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [],
      patches: [],
    });

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");
  });

  it("should warn if head sha was not in the loaded commits", async () => {
    // Mock GitHubService to return commits without head sha
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      number: 1,
      title: "test title",
      body: "test body",
      commitCount: 1,
      head: "head-sha",
      base: "base-sha",
    });

    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "base-sha",
          message: "test commit",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

    // Verify warning was logged
    expect(core.warning).toHaveBeenCalledWith(
      "PR head commit head-sha was not included in commit comparison."
    );
  });
});
