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
      start_line: 1,
      start_side: "RIGHT" as const,
      comment: "First comment",
      severity: "warning" as const,
    },
    {
      sha: "sha1",
      file: "second.ts",
      line: 2,
      side: "RIGHT" as const,
      start_line: 2,
      start_side: "RIGHT" as const,
      comment: "Second comment",
      severity: "info" as const,
    },
    {
      sha: "sha1",
      file: "first.ts",
      line: 10,
      side: "RIGHT" as const,
      start_line: 10,
      start_side: "RIGHT" as const,
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
    // Mock PR details response for all postReviewComments tests
    const mockPrResponse = {
      status: 200,
      data: {
        number: 1,
        title: "Test PR",
        body: "PR body",
        commits: 1,
        head: { sha: "head-sha" },
        base: { sha: "base-sha" },
      },
    };

    it("should handle successful review comments posting with single review", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockGet = vi.fn().mockResolvedValue(mockPrResponse);

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
            get: mockGet,
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
        patches // Cumulative PR diff
      );

      expect(reviewResult).toEqual({
        reviewChanges: 1,
        reviewComments: 1,
        issueComments: 1,
      });

      // P0 Fix: Single review call with all valid comments using HEAD sha
      expect(mockCreateReview).toHaveBeenCalledTimes(1);
      expect(mockCreateReview).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
        commit_id: "head-sha", // Uses HEAD sha from getPrDetails
        event: "REQUEST_CHANGES", // Because warning comment meets threshold
        comments: [
          {
            path: "first.ts",
            line: 1,
            side: "RIGHT",
            body: "First comment",
          },
          {
            path: "second.ts",
            line: 2,
            side: "RIGHT",
            body: "Second comment",
          },
        ],
      });

      // Verify that out-of-range comment was posted as a single bundled issue comment
      expect(mockCreateComment).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        issue_number: mockConfig.pullNumber,
        body: "**INFO** - first.ts:10\n\nOut of range comment",
      });
    });

    it("should handle comments with no matching patches (fallback to issue comments)", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockGet = vi.fn().mockResolvedValue(mockPrResponse);

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
            get: mockGet,
          },
          issues: {
            createComment: mockCreateComment,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const commentsWithNoPatches = [
        {
          sha: "nonexistent-sha",
          file: "missing.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Comment for file with no patch",
          severity: "warning" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(
        commentsWithNoPatches,
        "warning",
        [] // Empty commits array means no patches to validate against
      );

      expect(reviewResult).toEqual({
        reviewChanges: 0,
        reviewComments: 0,
        issueComments: 1,
      });

      // Verify that createReview was not called (no valid comments)
      expect(mockCreateReview).not.toHaveBeenCalled();

      // Verify that the comment was posted as an issue comment
      expect(mockCreateComment).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        issue_number: mockConfig.pullNumber,
        body: "**WARNING** - missing.ts:1\n\nComment for file with no patch",
      });
    });

    it("should handle comments with empty patches (out of range)", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockGet = vi.fn().mockResolvedValue(mockPrResponse);

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
            get: mockGet,
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
          start_line: 10,
          start_side: "LEFT" as const,
          comment: "Comment",
          severity: "info" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(
        comments,
        "error",
        [] // Empty cumulative diff - no patches to validate against
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
        body: "**INFO** - test.ts:10\n\nComment",
      });

      expect(core.warning).toBeCalledTimes(2);
      expect(core.warning).toHaveBeenCalledWith(
        "No patch found for file: test.ts"
      );
      expect(core.warning).toHaveBeenCalledWith(
        "Comment is out of range for test.ts:10:LEFT: Comment"
      );
    });

    it("should use COMMENT event when no comments meet severity threshold", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockGet = vi.fn().mockResolvedValue(mockPrResponse);

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
            get: mockGet,
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
          filename: "info.ts",
          patch: "@@ -0,0 +1,3 @@\n+First line\n+Second line\n+Third line",
        },
      ];
      const infoOnlyComments = [
        {
          sha: "sha1",
          file: "info.ts",
          line: 1,
          side: "RIGHT" as const,
          start_line: 1,
          start_side: "RIGHT" as const,
          comment: "Info comment",
          severity: "info" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(
        infoOnlyComments,
        "error", // High threshold - only errors trigger REQUEST_CHANGES
        patches // Cumulative PR diff
      );

      expect(reviewResult).toEqual({
        reviewChanges: 0,
        reviewComments: 1,
        issueComments: 0,
      });

      // Should use COMMENT event since no comments meet error threshold
      expect(mockCreateReview).toHaveBeenCalledTimes(1);
      expect(mockCreateReview).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "COMMENT",
        })
      );
    });

    /**
     * Regression test for multi-commit file validation bug.
     *
     * Previously, the code used `commits.flatMap(c => c.patches)` and then
     * `patches.find(p => p.filename === filename)` which would return the
     * FIRST patch for a file. This meant comments on lines changed in later
     * commits would fail validation.
     *
     * The fix uses the cumulative PR diff (base...HEAD) which contains all
     * changes merged into a single patch per file.
     */
    it("should validate comments against cumulative diff for files modified in multiple commits", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockGet = vi.fn().mockResolvedValue(mockPrResponse);

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
            get: mockGet,
          },
          issues: {
            createComment: mockCreateComment,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);

      // Cumulative PR diff: foo.ts was modified in two commits
      // - Commit A added lines 1-3
      // - Commit B added lines 50-52
      // The cumulative diff contains BOTH hunks merged
      const cumulativePatch = [
        {
          filename: "foo.ts",
          patch:
            "@@ -0,0 +1,3 @@\n+Line 1 from commit A\n+Line 2 from commit A\n+Line 3 from commit A\n" +
            "@@ -47,0 +50,3 @@\n+Line 50 from commit B\n+Line 51 from commit B\n+Line 52 from commit B",
        },
      ];

      // Comment targets line 51 - which was added in commit B
      // With the old bug, this would fail because .find() returned commit A's patch
      const commentOnLaterCommitChange = [
        {
          sha: "commit-b-sha",
          file: "foo.ts",
          line: 51,
          side: "RIGHT" as const,
          start_line: 51,
          start_side: "RIGHT" as const,
          comment: "Issue found on line added in commit B",
          severity: "warning" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(
        commentOnLaterCommitChange,
        "warning",
        cumulativePatch
      );

      // The comment should be valid (not demoted to issue comment)
      expect(reviewResult).toEqual({
        reviewChanges: 1,
        reviewComments: 0,
        issueComments: 0,
      });

      // Should create an inline review, not an issue comment
      expect(mockCreateReview).toHaveBeenCalledTimes(1);
      expect(mockCreateReview).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "REQUEST_CHANGES",
          comments: [
            expect.objectContaining({
              path: "foo.ts",
              line: 51,
              side: "RIGHT",
            }),
          ],
        })
      );

      // No fallback to issue comments
      expect(mockCreateComment).not.toHaveBeenCalled();
    });

    it("should bundle multiple out-of-range comments into a single issue comment", async () => {
      const mockCreateReview = vi.fn().mockResolvedValue({});
      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockGet = vi.fn().mockResolvedValue(mockPrResponse);

      const mockOctokit = {
        rest: {
          pulls: {
            createReview: mockCreateReview,
            get: mockGet,
          },
          issues: {
            createComment: mockCreateComment,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);

      // Multiple comments that will all be out of range (no patches to validate against)
      const multipleOutOfRangeComments = [
        {
          sha: "sha1",
          file: "file1.ts",
          line: 10,
          side: "RIGHT" as const,
          start_line: 10,
          start_side: "RIGHT" as const,
          comment: "First out of range comment",
          severity: "error" as const,
        },
        {
          sha: "sha1",
          file: "file2.ts",
          line: 20,
          side: "RIGHT" as const,
          start_line: 20,
          start_side: "RIGHT" as const,
          comment: "Second out of range comment",
          severity: "warning" as const,
        },
        {
          sha: "sha1",
          file: "file3.ts",
          line: 30,
          side: "LEFT" as const,
          start_line: 30,
          start_side: "LEFT" as const,
          comment: "Third out of range comment",
          severity: "info" as const,
        },
      ];

      const reviewResult = await service.postReviewComments(
        multipleOutOfRangeComments,
        "error",
        [] // Empty patches - all comments will be out of range
      );

      expect(reviewResult).toEqual({
        reviewChanges: 0,
        reviewComments: 0,
        issueComments: 3,
      });

      // Verify that createReview was not called (no valid comments)
      expect(mockCreateReview).not.toHaveBeenCalled();

      // Verify that only ONE issue comment was created with all comments bundled
      expect(mockCreateComment).toHaveBeenCalledTimes(1);
      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        issue_number: mockConfig.pullNumber,
        body:
          "**ERROR** - file1.ts:10\n\nFirst out of range comment\n\n---\n\n" +
          "**WARNING** - file2.ts:20\n\nSecond out of range comment\n\n---\n\n" +
          "**INFO** - file3.ts:30\n\nThird out of range comment",
      });
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
          parents: [{ sha: "parent1" }],
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
        parentCount: 1,
      });

      expect(mockGetCommit).toHaveBeenCalledExactlyOnceWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        ref: "testSha",
      });
    });

    it("should return parentCount for merge commits", async () => {
      const mockGetCommit = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commit: { message: "Merge branch 'master'" },
          files: [],
          parents: [{ sha: "parent1" }, { sha: "parent2" }],
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

      expect(result.parentCount).toBe(2);
    });

    it("should handle missing parents in commit result", async () => {
      const mockGetCommit = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          commit: { message: "Test commit" },
          files: [],
          // parents property is undefined
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

      expect(result.parentCount).toBe(0);
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
          parents: [{ sha: "parent1" }],
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
          parents: [{ sha: "parent1" }],
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
