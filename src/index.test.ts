import * as core from "@actions/core";
import * as github from "@actions/github";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";

type Context = {
  payload: Record<string, unknown>;
  eventName: string;
  sha: string;
  ref: string;
  workflow: string;
  action: string;
  actor: string;
  job: string;
  runNumber: number;
  runId: number;
  apiUrl: string;
  serverUrl: string;
  graphqlUrl: string;
  issue: { owner: string; repo: string; number: number };
  repo: { owner: string; repo: string };
};

// Mock types
type MockType = ReturnType<typeof vi.fn>;

// Mock dependencies
vi.mock("@actions/core");
vi.mock("@actions/github");
vi.mock("./azureOpenAIService.js");
vi.mock("./githubService.js");

describe("index", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock core.getInput
    (core.getInput as MockType).mockImplementation((name: string) => {
      switch (name) {
        case "azureOpenAIEndpoint":
          return "https://AZURE_ENDPOINT";
        case "azureOpenAIDeployment":
          return "AZURE_DEPLOYMENT";
        case "azureOpenAIKey":
          return "AZURE_API_KEY";
        case "azureOpenAIVersion":
          return "2024-12-01-preview";
        case "diffMode":
          return "last-commit";
        case "severity":
          return "info";
        case "reasoningEffort":
          return "medium";
        default:
          return "";
      }
    });

    // Mock GitHubService methods
    vi.mocked(GitHubService.prototype.getEntirePRDiff).mockResolvedValue({
      commitMessage: "Test PR Title\n\nTest PR Body",
      patches: [{ filename: "test.ts", patch: "test diff" }],
    });

    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "test commit",
      patches: [{ filename: "test.ts", patch: "test diff" }],
    });

    // Mock github context
    vi.mocked(github).context = {
      issue: {
        owner: "test-owner",
        repo: "test-repo",
        number: 1,
      },
      repo: {
        owner: "test-owner",
        repo: "test-repo",
      },
      payload: {},
      eventName: "pull_request",
      sha: "test-sha",
      ref: "refs/heads/main",
      workflow: "test-workflow",
      action: "test-action",
      actor: "test-actor",
      job: "test-job",
      runNumber: 1,
      runId: 1,
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      graphqlUrl: "https://api.github.com/graphql",
    } as Context;

    // Set GITHUB_TOKEN
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("should handle successful review flow", async () => {
    // Mock Azure OpenAI response
    const mockAzureResponse = {
      comments: [
        {
          file: "test.ts",
          line: 1,
          comment: "Test comment",
          severity: "info" as const,
        },
      ],
    };

    // Mock GitHub response
    const mockGitHubResponse = {
      skipped: false,
      commentsPosted: 1,
      commentsFiltered: 0,
    };

    // Setup service mocks
    vi.mocked(AzureOpenAIService.prototype.runReviewPrompt).mockResolvedValue(
      mockAzureResponse
    );
    vi.mocked(GitHubService.prototype.postReviewComments).mockResolvedValue(
      mockGitHubResponse
    );

    // Import and run the index file
    const { run } = await import("./index.js");
    await run();

    // Verify Azure OpenAI service was called
    expect(AzureOpenAIService.prototype.runReviewPrompt).toHaveBeenCalled();

    // Verify GitHub service was called
    expect(GitHubService.prototype.postReviewComments).toHaveBeenCalledWith(
      mockAzureResponse.comments,
      "info"
    );

    // Verify no errors were reported
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("should handle no diff found", async () => {
    // Mock GitHubService to return empty patches
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockResolvedValue({
      commitMessage: "",
      patches: [],
    });
    vi.mocked(GitHubService.prototype.getEntirePRDiff).mockResolvedValue({
      commitMessage: "",
      patches: [],
    });

    const { run } = await import("./index.js");
    await run();

    // Verify services were not called
    expect(AzureOpenAIService.prototype.runReviewPrompt).not.toHaveBeenCalled();
    expect(GitHubService.prototype.postReviewComments).not.toHaveBeenCalled();

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith(
      "No patches found for last-commit mode."
    );
  });

  it("should handle invalid inputs", async () => {
    // Mock invalid diffMode
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") {
        return "invalid";
      }
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    // Verify error was reported
    expect(core.setFailed).toHaveBeenCalledWith("Invalid diff mode: invalid");
  });

  it("should handle missing GITHUB_TOKEN", async () => {
    delete process.env.GITHUB_TOKEN;

    const { run } = await import("./index.js");
    await run();

    // Verify appropriate message was logged
    expect(core.info).toHaveBeenCalledWith(
      "No GitHub token found, returning null."
    );
  });

  it("should handle GitHub API errors", async () => {
    // Mock API error
    vi.mocked(GitHubService.prototype.getLastCommitDiff).mockRejectedValue(
      new Error("API Error")
    );

    const { run } = await import("./index.js");
    await run();

    // Verify error was logged
    expect(core.error).toHaveBeenCalledWith(
      "Failed to get git info: API Error"
    );
  });

  it("should handle entire-pr mode", async () => {
    // Mock diffMode input
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "diffMode") {
        return "entire-pr";
      }
      return "";
    });

    const { run } = await import("./index.js");
    await run();

    // Verify entire-pr API was called
    expect(GitHubService.prototype.getEntirePRDiff).toHaveBeenCalled();
    expect(GitHubService.prototype.getLastCommitDiff).not.toHaveBeenCalled();
  });
});
