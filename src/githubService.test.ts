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

    const mockOctokit = {
      rest: {
        pulls: {
          createReview: mockCreateReview,
        },
      },
    };

    (github.getOctokit as MockType).mockReturnValue(mockOctokit);

    const service = new GitHubService(mockConfig);
    const reviewResult = await service.postReviewComments(
      mockComments,
      "warning"
    );

    expect(reviewResult).toEqual({
      changesPosted: 1,
      commentsPosted: 1,
    });

    expect(mockCreateReview).toHaveBeenCalled();
  });
});
