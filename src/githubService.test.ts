import { GitHubService, type GitHubConfig } from "./githubService.js";
import * as github from "@actions/github";

// Mock types
type MockType = ReturnType<typeof vi.fn>;

// Mock the GitHub client
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
      file: "first.ts",
      line: 1,
      comment: "First comment",
      severity: "warning" as const,
    },
    {
      file: "second.ts",
      line: 2,
      comment: "Second comment",
      severity: "info" as const,
    },
    {
      file: "first.ts",
      line: 10,
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
    expect(github.getOctokit).toHaveBeenCalledWith(mockConfig.token);
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
      undefined,
      patches
    );

    expect(reviewResult).toEqual({
      changesPosted: 1,
      commentsPosted: 2,
    });

    // Verify that createReview was called with the correct parameters
    expect(mockCreateReview).toHaveBeenCalledWith({
      owner: mockConfig.owner,
      repo: mockConfig.repo,
      pull_number: mockConfig.pullNumber,
      commit_id: undefined,
      event: "REQUEST_CHANGES",
      comments: [
        {
          path: "first.ts",
          position: 1,
          body: "First comment",
        },
      ]
    });

    // Verify that out-of-range comment was posted as issue comment
    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: mockConfig.owner,
      repo: mockConfig.repo,
      issue_number: mockConfig.pullNumber,
      body: "Comment on line 10 of file first.ts: Out of range comment"
    });

    // Verify that createReview was called with the correct parameters
    expect(mockCreateReview).toHaveBeenCalledWith({
      owner: mockConfig.owner,
      repo: mockConfig.repo,
      pull_number: mockConfig.pullNumber,
      commit_id: undefined,
      event: "REQUEST_CHANGES",
      comments: [
        {
          path: "first.ts",
          position: expect.any(Number),
          body: "First comment",
        },
      ]
    });

    expect(mockCreateReview).toHaveBeenCalled();
  });

  describe("getEntirePRDiff", () => {
    it("should retrieve the entire PR diff with title and body", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          title: "Sample PR Title",
          body: "Sample PR Description",
        },
      });

      const mockListFiles = vi.fn().mockResolvedValue({
        data: [
          { filename: "file1.ts", patch: "diff for file1" },
          { filename: "file2.ts", patch: "diff for file2" },
        ],
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
            listFiles: mockListFiles,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getEntirePRDiff();

      expect(result.commitMessage).toBe(
        "Sample PR Title\n\nSample PR Description"
      );
      expect(result.patches).toHaveLength(2);
      expect(result.patches[0]).toEqual({
        filename: "file1.ts",
        patch: "diff for file1",
      });
      expect(result.patches[1]).toEqual({
        filename: "file2.ts",
        patch: "diff for file2",
      });

      expect(mockGet).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
      });

      expect(mockListFiles).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
      });
    });

    it("should handle PR with empty body", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          title: "PR Title Only",
          body: null,
        },
      });

      const mockListFiles = vi.fn().mockResolvedValue({
        data: [{ filename: "file.ts", patch: "diff content" }],
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
            listFiles: mockListFiles,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getEntirePRDiff();

      expect(result.commitMessage).toBe("PR Title Only");
      expect(result.patches).toHaveLength(1);
    });

    it("should handle PR with no file changes", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          title: "Empty PR",
          body: "No Changes",
        },
      });

      const mockListFiles = vi.fn().mockResolvedValue({
        data: [],
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
            listFiles: mockListFiles,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getEntirePRDiff();

      expect(result.commitMessage).toBe("Empty PR\n\nNo Changes");
      expect(result.patches).toHaveLength(0);
    });

    it("should handle files with missing patches", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          title: "PR with some patches",
          body: "Description",
        },
      });

      const mockListFiles = vi.fn().mockResolvedValue({
        data: [
          { filename: "file1.ts", patch: "diff1" },
          { filename: "file2.ts", patch: null },
          { filename: "file3.ts", patch: undefined },
        ],
      });

      const mockOctokit = {
        rest: {
          pulls: {
            get: mockGet,
            listFiles: mockListFiles,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getEntirePRDiff();

      expect(result.patches).toHaveLength(3);
      expect(result.patches[0].patch).toBe("diff1");
      expect(result.patches[1].patch).toBe("");
      expect(result.patches[2].patch).toBe("");
    });
  });

  describe("getLastCommitDiff", () => {
    it("should retrieve diff for the last commit", async () => {
      const mockListCommits = vi.fn().mockResolvedValue({
        data: [
          { sha: "parentSha", parents: [{ sha: "grandparentSha" }] },
          {
            sha: "lastCommitSha",
            parents: [{ sha: "parentSha" }],
            commit: { message: "Last commit message" },
          },
        ],
      });

      const mockCompareCommits = vi.fn().mockResolvedValue({
        data: {
          files: [
            { filename: "file1.ts", patch: "diff for file1" },
            { filename: "file2.ts", patch: "diff for file2" },
          ],
        },
      });

      const mockOctokit = {
        rest: {
          pulls: {
            listCommits: mockListCommits,
          },
          repos: {
            compareCommits: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getLastCommitDiff();

      expect(result).not.toBeNull();
      expect(result?.commitSha).toBe("lastCommitSha");
      expect(result?.commitMessage).toBe("Last commit message");
      expect(result?.patches).toHaveLength(2);
      expect(result?.patches[0]).toEqual({
        filename: "file1.ts",
        patch: "diff for file1",
      });

      expect(mockListCommits).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        pull_number: mockConfig.pullNumber,
      });

      expect(mockCompareCommits).toHaveBeenCalledWith({
        owner: mockConfig.owner,
        repo: mockConfig.repo,
        base: "parentSha",
        head: "lastCommitSha",
      });
    });

    it("should handle first commit in PR (no parent)", async () => {
      const mockListCommits = vi.fn().mockResolvedValue({
        data: [
          {
            sha: "firstCommitSha",
            parents: [],
            commit: { message: "First commit" },
          },
        ],
      });

      // Mock for getEntirePRDiff that will be called
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          title: "PR Title",
          body: "PR Body",
        },
      });

      const mockListFiles = vi.fn().mockResolvedValue({
        data: [{ filename: "file.ts", patch: "initial diff" }],
      });

      const mockOctokit = {
        rest: {
          pulls: {
            listCommits: mockListCommits,
            get: mockGet,
            listFiles: mockListFiles,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getLastCommitDiff();

      expect(result).not.toBeNull();
      expect(result?.commitSha).toBe("firstCommitSha");
      expect(result?.commitMessage).toBe("First commit");
      expect(result?.patches).toHaveLength(1);
    });

    it("should handle PR with no commits", async () => {
      const mockListCommits = vi.fn().mockResolvedValue({
        data: [],
      });

      const mockOctokit = {
        rest: {
          pulls: {
            listCommits: mockListCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getLastCommitDiff();

      expect(result).toBeNull();
    });

    it("should handle missing patches in compare result", async () => {
      const mockListCommits = vi.fn().mockResolvedValue({
        data: [
          {
            sha: "lastCommitSha",
            parents: [{ sha: "parentSha" }],
            commit: { message: "Last commit" },
          },
        ],
      });

      const mockCompareCommits = vi.fn().mockResolvedValue({
        data: {
          files: [
            { filename: "file1.ts", patch: "diff1" },
            { filename: "file2.ts", patch: null },
            { filename: "file3.ts" }, // missing patch
          ],
        },
      });

      const mockOctokit = {
        rest: {
          pulls: {
            listCommits: mockListCommits,
          },
          repos: {
            compareCommits: mockCompareCommits,
          },
        },
      };

      (github.getOctokit as MockType).mockReturnValue(mockOctokit);

      const service = new GitHubService(mockConfig);
      const result = await service.getLastCommitDiff();

      expect(result).not.toBeNull();
      expect(result?.patches).toHaveLength(3);
      expect(result?.patches[0].patch).toBe("diff1");
      expect(result?.patches[1].patch).toBe("");
      expect(result?.patches[2].patch).toBe("");
    });
  });

  it("should handle undefined files in compare result", async () => {
    const mockListCommits = vi.fn().mockResolvedValue({
      data: [
        {
          sha: "lastCommitSha",
          parents: [{ sha: "parentSha" }],
          commit: { message: "Last commit" },
        },
      ],
    });

    const mockCompareCommits = vi.fn().mockResolvedValue({
      data: {
        // files property is undefined
      },
    });

    const mockOctokit = {
      rest: {
        pulls: {
          listCommits: mockListCommits,
        },
        repos: {
          compareCommits: mockCompareCommits,
        },
      },
    };

    (github.getOctokit as MockType).mockReturnValue(mockOctokit);

    const service = new GitHubService(mockConfig);
    const result = await service.getLastCommitDiff();

    expect(result).not.toBeNull();
    expect(result?.patches).toHaveLength(0);
  });
});
