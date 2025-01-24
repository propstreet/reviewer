import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHubService, type GitHubConfig } from "./githubService.js";

// Mock types
type MockType = ReturnType<typeof vi.fn>;

// Mock the GitHub client
vi.mock("@actions/core");
vi.mock("@actions/github", () => ({
  getOctokit: vi.fn(),
}));

describe("GitHubService", () => {
  const mockConfig: GitHubConfig = {
    token: "GITHUB_TOKEN",
    owner: "OWNER",
    repo: "REPO",
    pullNumber: 1,
  };

  const mockComments = [
    {
      sha: "sha1",
      file: "first.ts",
      line: 1,
      side: "RIGHT" as const,
      comment: "First comment",
      severity: "warning" as const,
    },
    {
      sha: "sha1",
      file: "second.ts",
      line: 2,
      side: "RIGHT" as const,
      comment: "Second comment",
      severity: "info" as const,
    },
    {
      sha: "sha1",
      file: "first.ts",
      line: 10,
      side: "RIGHT" as const,
      comment: "Out of range comment",
      severity: "info" as const,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with correct configuration", () => {
    const service = new GitHubService(mockConfig);
    expect(service).toBeInstanceOf(GitHubService);
    expect(github.getOctokit).toHaveBeenCalledExactlyOnceWith(mockConfig.token);
  });

  describe("postReviewComments", () => {
    it("should handle successful review comments posting", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
          },
          issues: {
            createComment: mockCreateComment,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const patches = [
        {
          filename: "first.ts",
          patch: "@@ -0,0 +1,3 @@\n+First line\n+Second line\n+Third line",
        },
        {
          filename: "second.ts",
          patch: "@@ -0,0 +1,3 @@\n+First line\n+Second line\n+Third line",
        },
      ];
      const reviewResult = await service.postReviewComments(
        mockComments,
        "warning",
        [
          {
            commit: { sha: "sha1", message: "Commit message", patches },
            patches,
          },
        ]
      );

      expect(reviewResult).toEqual({
        reviewChanges: 1,
        reviewComments: 1,
        issueComments: 1,
      });

      // Verify that createReview was called with the correct parameters
      expect(mockCreateReview).toHaveBeenCalledTimes(2);
      expect(mockCreateReview).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
        commit_id: "sha1",
        event: "REQUEST_CHANGES",
        comments: [
          {
            path: "first.ts",
            line: 1,
            side: "RIGHT",
            body: "First comment",
          },
        ],
      });
      expect(mockCreateReview).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
        commit_id: "sha1",
        event: "COMMENT",
        comments: [
          {
            path: "second.ts",
            line: 2,
            side: "RIGHT",
            body: "Second comment",
          },
        ],
      });

      // Verify that out-of-range comment was posted as issue comment
      expect(mockCreateComment).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        issue_number: mockConfig.pullNumber,
        body: `Out of range comment

first.ts:10 (RIGHT)
\`\`\`diff
@@ -0,0 +1,3 @@
+First line
+Second line
+Third line
\`\`\`
`,
      });
    });

    it("should handle comments for missing commits", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
          },
          issues: {
            createComment: mockCreateComment,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const commentsWithMissingCommit = [
        {
          sha: "nonexistent-sha",
          file: "missing.ts",
          line: 1,
          side: "RIGHT" as const,
          comment: "Comment for missing commit",
          severity: "warning" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(
        commentsWithMissingCommit,
        "warning",
        [] // Empty commits array, so no commits will be found
      );

      expect(reviewResult).toEqual({
        reviewChanges: 0,
        reviewComments: 0,
        issueComments: 1,
      });

      // Verify that createReview was not called
      expect(mockCreateReview).not.toHaveBeenCalled();

      // Verify that the comment was posted as an issue comment
      expect(mockCreateComment).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        issue_number: mockConfig.pullNumber,
        body: "Comment on line 1 (RIGHT) of file missing.ts:\n\nComment for missing commit",
      });
    });

    it("should handle comments with missing patches", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
          },
          issues: {
            createComment: mockCreateComment,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const comments = [
        {
          sha: "test-sha",
          file: "test.ts",
          line: 10,
          side: "LEFT" as const,
          comment: "Comment",
          severity: "info" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(comments, "error", [
        {
          commit: {
            sha: "test-sha",
            message: "Commit message",
            patches: [],
          },
          patches: [],
        },
      ]);

      expect(reviewResult).toEqual({
        reviewChanges: 0,
        reviewComments: 0,
        issueComments: 1,
      });

      // Verify that createReview was not called
      expect(mockCreateReview).not.toHaveBeenCalled();

      // Verify that the comment was posted as an issue comment
      expect(mockCreateComment).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        issue_number: mockConfig.pullNumber,
        body: "Comment on line 10 (LEFT) of file test.ts:\n\nComment",
      });

      expect(core.warning).toBeCalledTimes(2);
      expect(core.warning).toHaveBeenCalledWith(
        "Could not generate inline comment for test.ts: Comment"
      );
      expect(core.warning).toHaveBeenCalledWith(
        "- patch not found in commit test-sha"
      );
    });
  });

  describe("getPrDetails", () => {
    it("should retrieve PR details successfully", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          number: 123,
          title: "Test PR",
          body: "PR description",
          commits: 3,
          head: { sha: "commit3" },
          base: { sha: "baseSha" },
          pushed_at: "2024-01-25T15:00:00Z",
        },
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getPrDetails();

      expect(result).toEqual({
        number: 123,
        title: "Test PR",
        body: "PR description",
        head: "commit3",
        base: "baseSha",
        commitCount: 3,
      });

      expect(mockGet).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
      });
    });

    it("should retrieve PR details without body", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          number: 1,
          title: "Test PR",
          commits: 1,
          head: { sha: "head-sha" },
          base: { sha: "base-sha" },
        },
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getPrDetails();

      expect(result).toEqual({
        number: 1,
        title: "Test PR",
        head: "head-sha",
        base: "base-sha",
        commitCount: 1,
      });

      expect(mockGet).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
      });
    });

    it("should handle non-200 status on pulls.get", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        status: 404,
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      await expect(service.getPrDetails()).rejects.toThrow(
        `Failed to list commits for pr #${mockConfig.pullNumber}, status: 404`
      );
    });
  });

  describe("getCommitDetails", () => {
    it("should retrieve commit details successfully", async () => {
      const mockGetCommit = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commit: { message: "Test commit message" },
          files: [
            { filename: "file1.ts", patch: "diff for file1" },
            { filename: "file2.ts", patch: "diff for file2" },
          ],
        },
      });

      const mockOctokit = {
        rest: {
          repos: {
            getCommit: mockGetCommit,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getCommitDetails("testSha");

      expect(result).toEqual({
        sha: "testSha",
        message: "Test commit message",
        patches: [
          { filename: "file1.ts", patch: "diff for file1" },
          { filename: "file2.ts", patch: "diff for file2" },
        ],
      });

      expect(mockGetCommit).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        ref: "testSha",
      });
    });

    it("should handle missing patches in commit result", async () => {
      const mockGetCommit = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commit: { message: "Test commit" },
          files: [
            { filename: "file1.ts", patch: null },
            { filename: "file2.ts", patch: "diff1" },
            { filename: "file3.ts" }, // missing patch
          ],
        },
      });

      const mockOctokit = {
        rest: {
          repos: {
            getCommit: mockGetCommit,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getCommitDetails("testSha");

      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].patch).toBe("diff1");
    });

    it("should handle undefined files in commit result", async () => {
      const mockGetCommit = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commit: { message: "Test commit" },
          // files property is undefined
        },
      });

      const mockOctokit = {
        rest: {
          repos: {
            getCommit: mockGetCommit,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getCommitDetails("testSha");

      expect(result.patches).toHaveLength(0);
    });

    it("should handle non-200 status code", async () => {
      const mockGetCommit = vi.fn().mockResolvedValue({
        status: 404,
      });

      const mockOctokit = {
        rest: {
          repos: {
            getCommit: mockGetCommit,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      await expect(service.getCommitDetails("testSha")).rejects.toThrow(
        "Failed to get commit details for testSha, status: 404"
      );
    });

    it("should handle non-Error exceptions", async () => {
      const mockGetCommit = vi.fn().mockRejectedValue("Test error");

      const mockOctokit = {
        rest: {
          repos: {
            getCommit: mockGetCommit,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      await expect(service.getCommitDetails("testSha")).rejects.toThrow(
        "Failed to get commit details: Test error"
      );
    });
  });

  describe("compareCommits", () => {
    it("should compare commits successfully", async () => {
      const mockCompareCommits = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commits: [
            {
              sha: "commit1",
              commit: { message: "Commit message" },
            },
          ],
          files: [
            { filename: "file1.ts", patch: "diff for file1" },
            { filename: "file2.ts", patch: "diff for file2" },
          ],
        },
      });

      const mockOctokit = {
        rest: {
          repos: {
            compareCommitsWithBasehead: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.compareCommits("baseSha", "headSha");

      expect(result.patches).toEqual([
        { filename: "file1.ts", patch: "diff for file1" },
        { filename: "file2.ts", patch: "diff for file2" },
      ]);

      expect(mockCompareCommits).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        basehead: "baseSha...headSha",
      });
    });

    it("should handle missing patches in compare result", async () => {
      const mockCompareCommits = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commits: [],
          files: [
            { filename: "file1.ts", patch: null },
            { filename: "file2.ts", patch: "diff1" },
            { filename: "file3.ts" }, // missing patch
          ],
        },
      });

      const mockOctokit = {
        rest: {
          repos: {
            compareCommitsWithBasehead: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.compareCommits("baseSha", "headSha");

      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].patch).toBe("diff1");
    });

    it("should handle undefined files in compare result", async () => {
      const mockCompareCommits = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commits: [],
          // files property is undefined
        },
      });

      const mockOctokit = {
        rest: {
          repos: {
            compareCommitsWithBasehead: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.compareCommits("baseSha", "headSha");

      expect(result.patches).toHaveLength(0);
    });

    it("should handle non-200 status code", async () => {
      const mockCompareCommits = vi.fn().mockResolvedValue({
        status: 404,
      });

      const mockOctokit = {
        rest: {
          repos: {
            compareCommitsWithBasehead: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      await expect(
        service.compareCommits("baseSha", "headSha")
      ).rejects.toThrow(
        "Failed to compare commit head headSha to base baseSha, status: 404"
      );
    });

    it("should handle non-Error exceptions", async () => {
      const mockCompareCommits = vi.fn().mockRejectedValue("Test error");

      const mockOctokit = {
        rest: {
          repos: {
            compareCommitsWithBasehead: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      await expect(
        service.compareCommits("baseSha", "headSha")
      ).rejects.toThrow("Failed to compare commits: Test error");
    });
  });

  describe("commitBelongsToPR", () => {
    it("should return true when commit belongs to PR", async () => {
      const mockListPRs = vi.fn().mockResolvedValue({
        data: [
          { number: 1 }, // Matches PR number from config
          { number: 2 },
        ],
      });

      const mockOctokit = {
        rest: {
          repos: {
            listPullRequestsAssociatedWithCommit: mockListPRs,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.commitBelongsToPR("test-sha");

      expect(result).toBe(true);
      expect(mockListPRs).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        commit_sha: "test-sha",
      });
    });

    it("should return false when commit does not belong to PR", async () => {
      const mockListPRs = vi.fn().mockResolvedValue({
        data: [
          { number: 2 }, // Different PR number
          { number: 3 },
        ],
      });

      const mockOctokit = {
        rest: {
          repos: {
            listPullRequestsAssociatedWithCommit: mockListPRs,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.commitBelongsToPR("test-sha");

      expect(result).toBe(false);
    });

    it("should return false when commit has no associated PRs", async () => {
      const mockListPRs = vi.fn().mockResolvedValue({
        data: [], // Empty array - no PRs
      });

      const mockOctokit = {
        rest: {
          repos: {
            listPullRequestsAssociatedWithCommit: mockListPRs,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.commitBelongsToPR("test-sha");

      expect(result).toBe(false);
    });

    it("should handle API errors", async () => {
      const mockListPRs = vi.fn().mockRejectedValue(new Error("API Error"));

      const mockOctokit = {
        rest: {
          repos: {
            listPullRequestsAssociatedWithCommit: mockListPRs,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      await expect(service.commitBelongsToPR("test-sha")).rejects.toThrow(
        "Failed to list PRs associated with commit test-sha: API Error"
      );
    });
  });
});
