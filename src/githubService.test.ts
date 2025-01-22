import { GitHubService, type GitHubConfig } from "./githubService.js";
import * as github from "@actions/github";

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
      body: "Comment on line 10 (RIGHT) of file first.ts: Out of range comment",
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
  });

  describe("compareCommits", () => {
    it("should compare commits successfully", async () => {
      const mockCompareCommits = vi.fn().mockResolvedValue({
        status: 200,
        data: {
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

      expect(result).toEqual([
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

      expect(result).toHaveLength(1);
      expect(result[0].patch).toBe("diff1");
    });

    it("should handle undefined files in compare result", async () => {
      const mockCompareCommits = vi.fn().mockResolvedValue({
        status: 200,
        data: {
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

      expect(result).toHaveLength(0);
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
  });
});
