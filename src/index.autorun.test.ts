import * as core from "@actions/core";
import * as github from "@actions/github";

vi.mock("@actions/core");
vi.mock("@actions/github");

type MockType = ReturnType<typeof vi.fn>;

describe("index autorun", () => {
  type RequireLike = { main?: object };

  beforeEach(() => {
    vi.clearAllMocks();
    (core.getInput as MockType).mockImplementation((name: string) => {
      if (name === "azureOpenAIEndpoint") return "https://example.com";
      if (name === "azureOpenAIDeployment") return "deployment";
      if (name === "azureOpenAIKey") return "key";
      if (name === "azureOpenAIVersion") return "2025-03-01-preview";
      return "";
    });
    process.env.GITHUB_TOKEN = "test-token";
    vi.mocked(github).context = {
      issue: { owner: "o", repo: "r", number: 1 },
      repo: { owner: "o", repo: "r" },
      payload: {},
      eventName: "pull_request",
      sha: "sha",
      ref: "ref",
      workflow: "",
      action: "",
      actor: "",
      job: "",
      runAttempt: 1,
      runNumber: 1,
      runId: 1,
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      graphqlUrl: "https://api.github.com/graphql",
    } as unknown as typeof github.context;
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.unstubAllGlobals();
  });

  it("executes run() when require.main is truthy and VITEST is not 'true'", async () => {
    vi.stubGlobal("require", { main: {} } as unknown as RequireLike);
    process.env.VITEST = "false";
    await vi.resetModules();
    await import("./index.js");
    expect(core.setFailed).toHaveBeenCalledWith(
      "Missing base or head sha to review."
    );
  });
});
