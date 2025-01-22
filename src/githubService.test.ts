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
      side: "LEFT" as const,
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
          side: "LEFT",
          body: "Second comment",
        },
      ],
    });

    // Verify that out-of-range comment was posted as issue comment
    expect(mockCreateComment).toHaveBeenCalledExactlyOnceWith({
      owner: mockConfig.owner,
      repo: mockConfig.repo,
      issue_number: mockConfig.pullNumber,
      body: "Comment on line 10 of file first.ts: Out of range comment",
    });
  });

  //   describe("getLastCommitDetails", () => {
  //     it("should retrieve diff for the last commit", async () => {
  //       const mockListCommits = vi.fn().mockResolvedValue({
  //         data: [
  //           { sha: "parentSha", parents: [{ sha: "grandparentSha" }] },
  //           {
  //             sha: "lastCommitSha",
  //             parents: [{ sha: "parentSha" }],
  //             commit: { message: "Last commit message" },
  //           },
  //         ],
  //       });

  //       const mockCompareCommits = vi.fn().mockResolvedValue({
  //         data: {
  //           files: [
  //             { filename: "file1.ts", patch: "diff for file1" },
  //             { filename: "file2.ts", patch: "diff for file2" },
  //           ],
  //         },
  //       });

  //       const mockOctokit = {
  //         rest: {
  //           pulls: {
  //             listCommits: mockListCommits,
  //           },
  //           repos: {
  //             compareCommitsWithBasehead: mockCompareCommits,
  //           },
  //         },
  //       };

  //       (github.getOctokit as MockType).mockReturnValue(mockOctokit);

  //       const service = new GitHubService(mockConfig);
  //       const result = await service.getLastCommitDetails();

  //       expect(result).not.toBeNull();
  //       expect(result?.sha).toBe("lastCommitSha");
  //       expect(result?.message).toBe("Last commit message");
  //       expect(result?.patches).toHaveLength(2);
  //       expect(result?.patches[0]).toEqual({
  //         filename: "file1.ts",
  //         patch: "diff for file1",
  //       });

  //       expect(mockListCommits).toHaveBeenCalledExactlyOnceWith({
  //         owner: mockConfig.owner,
  //         repo: mockConfig.repo,
  //         pull_number: mockConfig.pullNumber,
  //       });

  //       expect(mockCompareCommits).toHaveBeenCalledExactlyOnceWith({
  //         owner: mockConfig.owner,
  //         repo: mockConfig.repo,
  //         basehead: "parentSha...lastCommitSha",
  //       });
  //     });

  //     it("should handle first commit in PR (no parent)", async () => {
  //       const mockListCommits = vi.fn().mockResolvedValue({
  //         data: [
  //           {
  //             sha: "firstCommitSha",
  //             parents: [],
  //             commit: { message: "First commit" },
  //           },
  //         ],
  //       });

  //       // Mock for getEntirePRDiff that will be called
  //       const mockGet = vi.fn().mockResolvedValue({
  //         data: {
  //           title: "PR Title",
  //           body: "PR Body",
  //         },
  //       });

  //       const mockListFiles = vi.fn().mockResolvedValue({
  //         data: [{ filename: "file.ts", patch: "initial diff" }],
  //       });

  //       const mockOctokit = {
  //         rest: {
  //           pulls: {
  //             listCommits: mockListCommits,
  //             get: mockGet,
  //             listFiles: mockListFiles,
  //           },
  //         },
  //       };

  //       (github.getOctokit as MockType).mockReturnValue(mockOctokit);

  //       const service = new GitHubService(mockConfig);
  //       const result = await service.getLastCommitDetails();

  //       expect(result).not.toBeNull();
  //       expect(result?.sha).toBe("firstCommitSha");
  //       expect(result?.message).toBe("First commit");
  //       expect(result?.patches).toHaveLength(1);
  //     });

  //     it("should handle PR with no commits", async () => {
  //       const mockListCommits = vi.fn().mockResolvedValue({
  //         data: [],
  //       });

  //       const mockOctokit = {
  //         rest: {
  //           pulls: {
  //             listCommits: mockListCommits,
  //           },
  //         },
  //       };

  //       (github.getOctokit as MockType).mockReturnValue(mockOctokit);

  //       const service = new GitHubService(mockConfig);
  //       const result = await service.getLastCommitDetails();

  //       expect(result).toBeNull();
  //     });

  //     it("should handle missing patches in compare result", async () => {
  //       const mockListCommits = vi.fn().mockResolvedValue({
  //         data: [
  //           {
  //             sha: "lastCommitSha",
  //             parents: [{ sha: "parentSha" }],
  //             commit: { message: "Last commit" },
  //           },
  //         ],
  //       });

  //       const mockCompareCommits = vi.fn().mockResolvedValue({
  //         data: {
  //           files: [
  //             { filename: "file1.ts", patch: null },
  //             { filename: "file2.ts", patch: "diff1" },
  //             { filename: "file3.ts" }, // missing patch
  //           ],
  //         },
  //       });

  //       const mockOctokit = {
  //         rest: {
  //           pulls: {
  //             listCommits: mockListCommits,
  //           },
  //           repos: {
  //             compareCommitsWithBasehead: mockCompareCommits,
  //           },
  //         },
  //       };

  //       (github.getOctokit as MockType).mockReturnValue(mockOctokit);

  //       const service = new GitHubService(mockConfig);
  //       const result = await service.getLastCommitDetails();

  //       expect(result).not.toBeNull();
  //       expect(result?.patches).toHaveLength(1);
  //       expect(result?.patches[0].patch).toBe("diff1");
  //     });
  //   });

  //   it("should handle undefined files in compare result", async () => {
  //     const mockListCommits = vi.fn().mockResolvedValue({
  //       data: [
  //         {
  //           sha: "lastCommitSha",
  //           parents: [{ sha: "parentSha" }],
  //           commit: { message: "Last commit" },
  //         },
  //       ],
  //     });

  //     const mockCompareCommits = vi.fn().mockResolvedValue({
  //       data: {
  //         // files property is undefined
  //       },
  //     });

  //     const mockOctokit = {
  //       rest: {
  //         pulls: {
  //           listCommits: mockListCommits,
  //         },
  //         repos: {
  //           compareCommitsWithBasehead: mockCompareCommits,
  //         },
  //       },
  //     };

  //     (github.getOctokit as MockType).mockReturnValue(mockOctokit);

  //     const service = new GitHubService(mockConfig);
  //     const result = await service.getLastCommitDetails();

  //     expect(result).not.toBeNull();
  //     expect(result?.patches).toHaveLength(0);
  //   });
});
