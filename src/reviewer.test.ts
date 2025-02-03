import * as core from "@actions/core";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";
import { ReviewService, ReviewOptions, shouldExcludeFile } from "./reviewer.js";

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
          sha: "head-sha",
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

    vi.mocked(GitHubService.prototype.getCommitDetails).mockResolvedValue({
      sha: "head-sha",
      message: "test commit",
      patches: [{ filename: "commit.ts", patch: "commit diff" }],
    });

    vi.mocked(GitHubService.prototype.commitBelongsToPR).mockResolvedValue(
      true
    );
  });

  /* eslint-disable @typescript-eslint/no-unused-vars */
  it("should handle successful review flow", async () => {
    // Mock isWithinTokenLimit to allow diff processing and return token count
    const { isWithinTokenLimit } = await import(
      "gpt-tokenizer/encoding/o200k_base"
    );
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
            sha: "head-sha",
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
    const { isWithinTokenLimit } = await import(
      "gpt-tokenizer/encoding/o200k_base"
    );

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
    const { isWithinTokenLimit } = await import(
      "gpt-tokenizer/encoding/o200k_base"
    );
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
    const { isWithinTokenLimit } = await import(
      "gpt-tokenizer/encoding/o200k_base"
    );
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
});
