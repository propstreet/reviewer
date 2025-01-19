import { describe, it, expect, vi } from "vitest";
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
    token: "test-token",
    owner: "test-owner",
    repo: "test-repo",
    pullNumber: 1,
  };

  const mockComments = [
    {
      file: "test.ts",
      line: 1,
      comment: "Test comment",
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
    const mockListFiles = vi.fn().mockResolvedValue({
      data: [
        {
          filename: "test.ts",
          patch: "@@ -1,1 +1,2 @@\n line1\n+line2",
        },
      ],
    });

    const mockCreateReview = vi.fn().mockResolvedValue({});

    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: mockListFiles,
          createReview: mockCreateReview,
        },
      },
    };

    (github.getOctokit as MockType).mockReturnValue(mockOctokit);

    const service = new GitHubService(mockConfig);
    const reviewResult = await service.postReviewComments(mockComments, "info");

    expect(reviewResult).toEqual({
      skipped: false,
      commentsPosted: 1,
      commentsFiltered: 0,
    });

    expect(mockListFiles).toHaveBeenCalledWith({
      owner: mockConfig.owner,
      repo: mockConfig.repo,
      pull_number: mockConfig.pullNumber,
    });

    expect(mockCreateReview).toHaveBeenCalled();
    expect(reviewResult).toEqual({
      skipped: false,
      commentsPosted: 1,
      commentsFiltered: 0,
    });
  });

  it("should skip when no comments meet severity threshold", async () => {
    const mockListFiles = vi.fn().mockResolvedValue({
      data: [
        {
          filename: "test.ts",
          patch: "@@ -1,1 +1,2 @@\n line1\n+line2",
        },
      ],
    });

    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: mockListFiles,
        },
      },
    };

    (github.getOctokit as MockType).mockReturnValue(mockOctokit);

    const service = new GitHubService(mockConfig);
    const reviewResult = await service.postReviewComments(mockComments, "error");

    expect(reviewResult).toEqual({
      skipped: true,
      reason: "No comments at or above severity: error",
    });
  });

  it("should handle missing file patches", async () => {
    const mockListFiles = vi.fn().mockResolvedValue({
      data: [
        {
          filename: "test.ts",
          // No patch provided
        },
      ],
    });

    const mockCreateReview = vi.fn().mockResolvedValue({});

    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: mockListFiles,
          createReview: mockCreateReview,
        },
      },
    };

    (github.getOctokit as MockType).mockReturnValue(mockOctokit);

    const service = new GitHubService(mockConfig);
    const reviewResult = await service.postReviewComments(mockComments, "info");
    expect(reviewResult).toEqual({
      skipped: false,
      commentsPosted: 1,
      commentsFiltered: 0,
    });
    expect(mockCreateReview).toHaveBeenCalledWith(expect.objectContaining({
      comments: expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringContaining("File test.ts not found or no patch"),
        }),
      ]),
    }));
  });
});
