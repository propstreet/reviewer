import * as core from "@actions/core";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";
import {
  ReviewService,
  ReviewOptions,
  shouldExcludeFile,
  generateSummaryComment,
} from "./reviewer.js";

// Mock types
//type MockType = ReturnType<typeof vi.fn>;

// Mock dependencies
vi.mock("@actions/core");
vi.mock("@actions/github");
vi.mock("./azureOpenAIService.js");
vi.mock("./githubService.js");
vi.mock("gpt-tokenizer/encoding/o200k_base", () => ({
  isWithinTokenLimit: vi.fn(),
}));

describe("shouldExcludeFile", () => {
  it("should match glob patterns", () => {
    expect(shouldExcludeFile("test.ts", ["*.ts"])).toBe("*.ts");
    expect(shouldExcludeFile("src/test.ts", ["src/**/*.ts"])).toBe(
      "src/**/*.ts"
    );
    expect(shouldExcludeFile("test.js", ["*.ts"])).toBe(false);
  });

  it("should handle multiple patterns", () => {
    expect(shouldExcludeFile("test.ts", ["*.js", "*.ts"])).toBe("*.ts");
    expect(shouldExcludeFile("test.js", ["*.js", "*.ts"])).toBe("*.js");
    expect(shouldExcludeFile("test.jsx", ["*.js", "*.ts"])).toBe(false);
  });

  it("should handle nested paths", () => {
    expect(shouldExcludeFile("dist/bundle.js", ["dist/**/*"])).toBe(
      "dist/**/*"
    );
    expect(shouldExcludeFile("src/dist/bundle.js", ["dist/**/*"])).toBe(false);
    expect(shouldExcludeFile("src/dist/bundle.js", ["**/dist/**/*"])).toBe(
      "**/dist/**/*"
    );
  });

  it("should handle empty pattern list", () => {
    expect(shouldExcludeFile("test.ts", [])).toBe(false);
  });

  it("should handle empty pattern string", () => {
    expect(shouldExcludeFile("test.ts", [""])).toBe(false);
    expect(shouldExcludeFile("", ["*.ts"])).toBe(false);
    expect(shouldExcludeFile("", [""])).toBe(false);
  });

  it("should handle edge cases", () => {
    // Trailing/leading whitespace should be trimmed
    expect(shouldExcludeFile("test.ts", [" *.ts "])).toBe("*.ts"); // Pattern should be trimmed
    expect(shouldExcludeFile("test.ts", ["  "])).toBe(false);

    // Special characters
    expect(shouldExcludeFile("test.ts", ["*.ts,"])).toBe(false); // trailing comma
    expect(shouldExcludeFile("test.ts", [",*.ts"])).toBe(false); // leading comma
    expect(shouldExcludeFile("test.ts", ["*.ts;"])).toBe(false); // trailing semicolon

    // Multiple dots
    expect(shouldExcludeFile("test.min.js", ["*.min.*"])).toBe("*.min.*");
    expect(shouldExcludeFile("test..js", ["*..js"])).toBe("*..js");

    // Unicode characters
    expect(shouldExcludeFile("test.🚀.ts", ["*.🚀.*"])).toBe("*.🚀.*");
    expect(shouldExcludeFile("test.ts", ["*.📝"])).toBe(false);
  });
});

describe("reviewer", () => {
  const reviewOptions: ReviewOptions = {
    tokenLimit: 1234,
    changesThreshold: "error",
    reasoningEffort: "low",
    commitLimit: 10,
    base: "base-sha",
    head: "head-sha",
    skipMergeCommits: true,
  };

  const mockedGithubService = new GitHubService({
    token: "test-token",
    owner: "test-owner",
    repo: "test-repo",
    pullNumber: 1,
  });

  const mockedAzureService = new AzureOpenAIService({
    apiKey: "test-key",
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
          sha: "head-sha",
          message: "test commit",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
          parentCount: 1,
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

    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "test commit",
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
      parentCount: 1,
    });

    vi.mocked(GitHubService.prototype.commitBelongsToPR).mockResolvedValue(
      true
    );

    vi.mocked(GitHubService.prototype.postSummaryComment).mockResolvedValue(
      undefined
    );
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should handle successful review flow", async () => {
    // Mock isWithinTokenLimit to allow diff processing and return token count
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234 // Return specific token count for verification
    );

    // Verify token count is logged
    const infoSpy = vi.spyOn(core, "info");

    // Mock Azure OpenAI response
    const mockAzureResponse = {
      comments: [
        {
          sha: "head-sha",
          file: "test.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
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
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(true);

    // Verify Azure OpenAI service was called
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalledWith(
      `# test title

test body

## COMMIT SHA: head-sha

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
      // Cumulative PR diff (base...HEAD) from compareCommits
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
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");

    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => {
        // Simulate first patch being too large
        return false; // Return false when exceeding token limit
      }
    );

    // Import and run the reviewer
    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

    // Verify warning was logged
    expect(core.warning).toHaveBeenCalledWith(
      "No patches used in commit block."
    );
    // Verify Azure OpenAI service was not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should handle some patches within token limit", async () => {
    // Mock isWithinTokenLimit to simulate selective patch inclusion
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
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
      parentCount: 1,
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
          parentCount: 1,
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
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(true);

    // Verify warning about skipped patches
    expect(core.warning).toHaveBeenCalledWith(
      "1 patches were skipped due to exclusion patterns or token limit."
    );
    // Verify Azure OpenAI service was called (since some patches fit)
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalled();

    // Verify token count was logged correctly for final diff
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Token Count: 5678")
    );
  });

  it("should handle no diff found", async () => {
    // Mock compareCommits to return empty results
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [],
      patches: [],
    });

    // Mock getCommitDetails to ensure it doesn't add the head commit
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "head commit",
      patches: [], // Empty patches
      parentCount: 1,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

    // Verify services were not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");
  });

  it("should handle empty AI response", async () => {
    // Mock isWithinTokenLimit to allow diff processing
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1000 // Return token count instead of boolean
    );

    // Mock successful diff retrieval
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "head-sha",
          message: "test commit",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
          parentCount: 1,
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
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

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

    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "test commit",
      patches: [],
      parentCount: 1,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");
  });

  it("should silently add missing head commit", async () => {
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
          parentCount: 1,
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

    // Verify getCommitDetails was called for head commit
    expect(GitHubService.prototype.getCommitDetails).toHaveBeenCalledWith(
      "head-sha"
    );

    // Verify debug message was logged
    expect(core.debug).toHaveBeenCalledWith(
      "Added missing head commit head-sha to results."
    );
  });

  // Add new test for skipping commits not belonging to PR
  it("should skip commits not belonging to PR", async () => {
    // Mock commitBelongsToPR to return false
    vi.mocked(GitHubService.prototype.commitBelongsToPR).mockResolvedValue(
      false
    );

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

    // Verify skip message was logged
    expect(core.info).toHaveBeenCalledWith(
      "Skipping commit head-sha as it does not belong to the current PR."
    );
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");
  });

  it("should skip merge commits by default", async () => {
    // Mock compareCommits to return a merge commit (parentCount > 1)
    // The merge check now happens early using compareCommits data
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "head-sha",
          message: "Merge branch 'master' into feature",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
          parentCount: 2,
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);

    // Verify skip message was logged
    expect(core.info).toHaveBeenCalledWith(
      "Skipping merge commit head-sha - merged changes were reviewed in their original PRs."
    );
    expect(core.info).toHaveBeenCalledWith("No commits found to review.");

    // Verify that heavier work (Azure call) was skipped
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
  });

  it("should not skip merge commits when skipMergeCommits is false", async () => {
    // Mock isWithinTokenLimit to allow diff processing
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234
    );

    // Mock compareCommits to return a merge commit (parentCount > 1)
    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "head-sha",
          message: "Merge branch 'master' into feature",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
          parentCount: 2,
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    // Mock getCommitDetails for when the commit is processed (not skipped)
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "Merge branch 'master' into feature",
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
      parentCount: 2,
    });

    // Mock Azure response with a comment to verify full flow works
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [
        {
          sha: "head-sha",
          file: "commit.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    });
    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue({
      reviewChanges: 0,
      reviewComments: 1,
      issueComments: 0,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review({
      ...reviewOptions,
      skipMergeCommits: false,
    });

    expect(result).toBe(true);

    // Verify the commit was NOT skipped
    expect(core.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Skipping merge commit")
    );

    // Verify Azure was called (heavier work was NOT skipped)
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalled();
  });

  it("should skip files matching exclude patterns", async () => {
    // Mock isWithinTokenLimit to allow diff processing
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234
    );

    // Mock getCommitDetails with multiple files including excluded ones
    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "test commit",
      patches: [
        { filename: "src/app.ts", patch: "app diff" },
        { filename: "src/app.test.ts", patch: "test diff" },
        { filename: "dist/bundle.js", patch: "dist diff" },
      ],
      parentCount: 1,
    });

    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "head-sha",
          message: "test commit",
          patches: [
            { filename: "src/app.ts", patch: "app diff" },
            { filename: "src/app.test.ts", patch: "test diff" },
            { filename: "dist/bundle.js", patch: "dist diff" },
          ],
          parentCount: 1,
        },
      ],
      patches: [
        { filename: "src/app.ts", patch: "app diff" },
        { filename: "src/app.test.ts", patch: "test diff" },
        { filename: "dist/bundle.js", patch: "dist diff" },
      ],
    });

    // Mock Azure and GitHub responses
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [],
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    const result = await reviewService.review({
      ...reviewOptions,
      excludePatterns: ["**/*.test.ts", "dist/**/*"],
    });

    expect(result).toBe(false); // No comments from AI

    // Verify excluded files were logged
    expect(core.debug).toHaveBeenCalledWith(
      "Skipping excluded file: src/app.test.ts (matched pattern: **/*.test.ts)"
    );
    expect(core.debug).toHaveBeenCalledWith(
      "Skipping excluded file: dist/bundle.js (matched pattern: dist/**/*)"
    );

    // Verify warning about skipped patches
    expect(core.warning).toHaveBeenCalledWith(
      "2 patches were skipped due to exclusion patterns or token limit."
    );
  });

  it("should pass customPrompt to Azure service", async () => {
    // Mock isWithinTokenLimit to allow diff processing
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234
    );

    // Mock Azure response with comments
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [
        {
          sha: "head-sha",
          file: "commit.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    });

    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue({
      reviewChanges: 0,
      reviewComments: 1,
      issueComments: 0,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review({
      ...reviewOptions,
      customPrompt: "Focus on security issues",
    });

    // Verify Azure service was called with customPrompt
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalledWith(
      expect.any(String),
      { reasoningEffort: "low", customPrompt: "Focus on security issues" }
    );
  });

  it("should use full PR diff for validation when options range differs from PR range", async () => {
    // This tests the fix for synchronize events where options.base/head differ from PR base/head
    // GitHub validates review comments against full PR diff, not the narrow commit range

    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(() => 1234);

    // PR details show full range (pr-base -> head-sha)
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      number: 1,
      title: "test title",
      body: "test body",
      commitCount: 3,
      head: "head-sha",
      base: "pr-base-sha", // Different from options.base!
    });

    // First compareCommits call: narrow range (previous-head -> head-sha) for synchronize event
    // Second compareCommits call: full PR range (pr-base-sha -> head-sha) for validation
    vi.mocked(GitHubService.prototype.compareCommits)
      .mockResolvedValueOnce({
        base: "previous-head-sha",
        head: "head-sha",
        commits: [
          {
            sha: "head-sha",
            message: "latest commit",
            patches: [{ filename: "changed.ts", patch: "narrow diff" }],
            parentCount: 1,
          },
        ],
        patches: [{ filename: "changed.ts", patch: "narrow diff" }],
      })
      .mockResolvedValueOnce({
        base: "pr-base-sha",
        head: "head-sha",
        commits: [],
        patches: [
          { filename: "changed.ts", patch: "full pr diff" },
          { filename: "other.ts", patch: "other file diff" },
        ],
      });

    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [
        {
          sha: "head-sha",
          file: "changed.ts",
          line: 10,
          side: "RIGHT" as const,
          start_line: 10,
          start_side: "RIGHT" as const,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    });

    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue({
      reviewChanges: 0,
      reviewComments: 1,
      issueComments: 0,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );

    // Review with narrow range (simulating synchronize event)
    await reviewService.review({
      ...reviewOptions,
      base: "previous-head-sha", // Different from prDetails.base
      head: "head-sha",
    });

    // Verify compareCommits was called with both ranges:
    // - Narrow range for building prompt
    // - Full PR range for validation
    expect(GitHubService.prototype.compareCommits).toHaveBeenCalledWith(
      "previous-head-sha",
      "head-sha"
    );
    expect(GitHubService.prototype.compareCommits).toHaveBeenCalledWith(
      "pr-base-sha",
      "head-sha"
    );

    // Verify postReviewComments receives full PR diff for validation
    expect(GitHubService.prototype.postReviewComments).toHaveBeenCalledWith(
      expect.any(Array),
      "error",
      [
        { filename: "changed.ts", patch: "full pr diff" },
        { filename: "other.ts", patch: "other file diff" },
      ]
    );
  });

  it("should reuse compareCommits result when options range matches PR range", async () => {
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(() => 1234);

    // PR details match options range
    vi.mocked(GitHubService.prototype.getPrDetails).mockResolvedValue({
      number: 1,
      title: "test title",
      body: "test body",
      commitCount: 1,
      head: "head-sha",
      base: "base-sha", // Same as options.base
    });

    vi.mocked(GitHubService.prototype.compareCommits).mockResolvedValue({
      base: "base-sha",
      head: "head-sha",
      commits: [
        {
          sha: "head-sha",
          message: "test commit",
          patches: [{ filename: "commit.ts", patch: "commit diff" }],
          parentCount: 1,
        },
      ],
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [
        {
          sha: "head-sha",
          file: "commit.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    });

    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue({
      reviewChanges: 0,
      reviewComments: 1,
      issueComments: 0,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );

    await reviewService.review(reviewOptions);

    // Verify compareCommits was only called once (no extra call for validation)
    expect(GitHubService.prototype.compareCommits).toHaveBeenCalledTimes(1);
  });

  it("should post summary comment after successful review with issues", async () => {
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234
    );

    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [
        {
          sha: "head-sha",
          file: "test.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    });

    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue({
      reviewChanges: 1,
      reviewComments: 2,
      issueComments: 1,
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

    // Verify postSummaryComment was called
    expect(GitHubService.prototype.postSummaryComment).toHaveBeenCalledTimes(1);
    const summaryArg = vi.mocked(GitHubService.prototype.postSummaryComment)
      .mock.calls[0][0];
    expect(summaryArg).toContain("Review Complete");
    expect(summaryArg).toContain("4");
    expect(summaryArg).toContain("changes requested");

    expect(core.info).toHaveBeenCalledWith("Posted summary comment.");
  });

  it("should not fail review when summary comment posting fails (no issues path)", async () => {
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1000
    );

    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [],
    });

    vi.mocked(GitHubService.prototype.postSummaryComment).mockRejectedValue(
      new Error("API rate limit")
    );

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    // Should not throw even though postSummaryComment fails
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(false);
    expect(core.warning).toHaveBeenCalledWith(
      "Failed to post summary comment: API rate limit"
    );
  });

  it("should not fail review when summary comment posting fails (issues path)", async () => {
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1234
    );

    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [
        {
          sha: "head-sha",
          file: "test.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    });

    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue({
      reviewChanges: 0,
      reviewComments: 1,
      issueComments: 0,
    });

    vi.mocked(GitHubService.prototype.postSummaryComment).mockRejectedValue(
      new Error("Network error")
    );

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    // Should not throw even though postSummaryComment fails
    const result = await reviewService.review(reviewOptions);

    expect(result).toBe(true);
    expect(core.warning).toHaveBeenCalledWith(
      "Failed to post summary comment: Network error"
    );
  });

  it("should post summary comment when AI returns no suggestions", async () => {
    const { isWithinTokenLimit } =
      await import("gpt-tokenizer/encoding/o200k_base");
    vi.mocked(isWithinTokenLimit).mockImplementation(
      (_input: unknown, _tokenLimit: number) => 1000
    );

    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue({
      comments: [],
    });

    const reviewService = new ReviewService(
      mockedGithubService,
      mockedAzureService
    );
    await reviewService.review(reviewOptions);

    // Verify postSummaryComment was called with a clean message
    expect(GitHubService.prototype.postSummaryComment).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith(
      "Posted summary comment (no issues found)."
    );
  });
});

describe("generateSummaryComment", () => {
  it("should return a clean-code message when no issues found", () => {
    const result = generateSummaryComment({
      reviewChanges: 0,
      reviewComments: 0,
      issueComments: 0,
    });

    // Should be one of the three clean messages
    expect(result).toMatch(/Flawless Victory|sparkling clean|Perfect Score/);
  });

  it("should handle single issue", () => {
    const result = generateSummaryComment({
      reviewChanges: 1,
      reviewComments: 0,
      issueComments: 0,
    });

    expect(result).toContain("**1** issue");
    expect(result).toContain("Not bad");
    expect(result).toContain("changes requested");
    expect(result).toContain("changes were requested");
  });

  it("should handle a few issues (2-3)", () => {
    const result = generateSummaryComment({
      reviewChanges: 1,
      reviewComments: 1,
      issueComments: 1,
    });

    expect(result).toContain("**3** issues");
    expect(result).toContain("tidy up");
  });

  it("should handle moderate issues (4-10)", () => {
    const result = generateSummaryComment({
      reviewChanges: 3,
      reviewComments: 3,
      issueComments: 1,
    });

    expect(result).toContain("**7** issues");
    expect(result).toContain("work to do");
  });

  it("should handle many issues (>10)", () => {
    const result = generateSummaryComment({
      reviewChanges: 5,
      reviewComments: 5,
      issueComments: 5,
    });

    expect(result).toContain("**15** issues");
    expect(result).toContain("Buckle up");
  });

  it("should show non-blocking message when no changes requested", () => {
    const result = generateSummaryComment({
      reviewChanges: 0,
      reviewComments: 3,
      issueComments: 0,
    });

    expect(result).toContain("nothing blocking the merge");
    expect(result).not.toContain("changes were requested");
  });

  it("should show blocking message when changes requested", () => {
    const result = generateSummaryComment({
      reviewChanges: 2,
      reviewComments: 0,
      issueComments: 0,
    });

    expect(result).toContain("changes were requested");
    expect(result).toContain("address them before merging");
  });

  it("should include breakdown parts", () => {
    const result = generateSummaryComment({
      reviewChanges: 2,
      reviewComments: 3,
      issueComments: 1,
    });

    expect(result).toContain("**2** changes requested");
    expect(result).toContain("**3** comments");
    expect(result).toContain("**1** general comments");
  });

  it("should only show relevant breakdown parts", () => {
    const result = generateSummaryComment({
      reviewChanges: 0,
      reviewComments: 5,
      issueComments: 0,
    });

    expect(result).not.toContain("changes requested");
    expect(result).toContain("**5** comments");
    expect(result).not.toContain("general comments");
  });

  it("should include powered by footer when issues found", () => {
    const result = generateSummaryComment({
      reviewChanges: 1,
      reviewComments: 0,
      issueComments: 0,
    });

    expect(result).toContain("Powered by Pro PR Reviewer");
  });

  it("should select deterministic clean message when messageIndex is provided", () => {
    const noIssues = {
      reviewChanges: 0,
      reviewComments: 0,
      issueComments: 0,
    };

    const msg0 = generateSummaryComment(noIssues, 0);
    const msg1 = generateSummaryComment(noIssues, 1);
    const msg2 = generateSummaryComment(noIssues, 2);
    // Index wraps around
    const msg3 = generateSummaryComment(noIssues, 3);

    expect(msg0).toContain("sparkling clean");
    expect(msg1).toContain("Flawless Victory");
    expect(msg2).toContain("Perfect Score");
    expect(msg3).toBe(msg0); // wraps around
  });

  it("should ignore messageIndex when issues are found", () => {
    const result = generateSummaryComment(
      { reviewChanges: 1, reviewComments: 0, issueComments: 0 },
      0
    );

    // Should still be a normal issues summary, not a clean message
    expect(result).toContain("Review Complete");
    expect(result).toContain("**1** issue");
  });
});
