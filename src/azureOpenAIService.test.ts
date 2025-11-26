import {
  AzureOpenAIService,
  type AzureOpenAIConfig,
  type ReviewPromptConfig,
} from "./azureOpenAIService.js";
import OpenAI from "openai";

// Mock the OpenAI client
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    responses: {
      parse: vi.fn(),
    },
  })),
}));

describe("AzureOpenAIService", () => {
  const mockConfig: AzureOpenAIConfig = {
    endpoint: "https://AZURE_ENDPOINT",
    deployment: "AZURE_DEPLOYMENT",
    apiKey: "AZURE_API_KEY",
  };

  const mockReviewConfig: ReviewPromptConfig = {
    reasoningEffort: "medium",
  };

  const mockInput =
    "# test: add new feature\n\n```diff\n@@ -1,1 +1,1 @@\n-test\n+new feature\n```";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with correct configuration", () => {
    const service = new AzureOpenAIService(mockConfig);
    expect(service).toBeInstanceOf(AzureOpenAIService);
    expect(OpenAI).toHaveBeenCalledExactlyOnceWith({
      apiKey: mockConfig.apiKey,
      baseURL: `${mockConfig.endpoint}/openai/v1`,
      defaultQuery: { "api-version": "preview" },
      defaultHeaders: { "api-key": mockConfig.apiKey },
    });
  });

  it("should handle endpoint with trailing slash", () => {
    const configWithSlash = {
      ...mockConfig,
      endpoint: "https://AZURE_ENDPOINT/",
    };
    const service = new AzureOpenAIService(configWithSlash);
    expect(service).toBeInstanceOf(AzureOpenAIService);
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://AZURE_ENDPOINT/openai/v1",
      })
    );
  });

  it("should handle successful review prompt", async () => {
    const mockResponse = {
      output_parsed: {
        comments: [
          {
            sha: "abc123",
            file: "test.ts",
            line: 1,
            side: "RIGHT",
            comment: "Test comment",
            severity: "info",
          },
        ],
      },
    };

    const service = new AzureOpenAIService(mockConfig);
    const parseMock = vi.fn().mockResolvedValue(mockResponse);
    type MockClient = {
      client: {
        responses: {
          parse: typeof parseMock;
        };
      };
    };
    (service as unknown as MockClient).client.responses.parse = parseMock;

    const result = await service.runReviewPrompt(mockInput, mockReviewConfig);

    // zodTextFormat produces a flat structure (not nested under json_schema)
    const expectedSchema = {
      name: "review_comments",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        properties: {
          comments: {
            items: {
              additionalProperties: false,
              properties: {
                comment: {
                  description: "The text of the review comment.",
                  type: "string",
                },
                file: {
                  description:
                    "The relative path to the file that necessitates a comment.",
                  type: "string",
                },
                line: {
                  description:
                    "The ending line of the comment in the pull request diff. For single-line comments, this equals start_line.",
                  type: "number",
                },
                severity: {
                  enum: ["info", "warning", "error"],
                  type: "string",
                },
                sha: {
                  description: "The SHA of the commit needing a comment.",
                  type: "string",
                },
                side: {
                  description:
                    "The side of the diff for the ending line. Can be LEFT (deletions/red) or RIGHT (additions/green or context). For single-line comments, this equals start_side.",
                  enum: ["LEFT", "RIGHT"],
                  type: "string",
                },
                start_line: {
                  description:
                    "The starting line of the comment range. For single-line comments, set this equal to line.",
                  type: "number",
                },
                start_side: {
                  description:
                    "The side of the diff for the starting line. For single-line comments, set this equal to side.",
                  enum: ["LEFT", "RIGHT"],
                  type: "string",
                },
              },
              required: [
                "sha",
                "file",
                "line",
                "side",
                "start_line",
                "start_side",
                "comment",
                "severity",
              ],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["comments"],
        type: "object",
      },
      strict: true,
      type: "json_schema",
    };

    expect(parseMock).toHaveBeenCalledWith({
      model: mockConfig.deployment,
      instructions: expect.stringContaining("helpful code reviewer"),
      input: mockInput,
      reasoning: { effort: mockReviewConfig.reasoningEffort },
      text: { format: expectedSchema },
    });
    expect(result).toEqual(mockResponse.output_parsed);
  });

  it("should throw error when review does not return parsed output", async () => {
    const mockResponse = {
      output_parsed: null,
    };

    const service = new AzureOpenAIService(mockConfig);
    const parseMock = vi.fn().mockResolvedValue(mockResponse);
    type MockClient = {
      client: {
        responses: {
          parse: typeof parseMock;
        };
      };
    };
    (service as unknown as MockClient).client.responses.parse = parseMock;

    await expect(
      service.runReviewPrompt(mockInput, mockReviewConfig)
    ).rejects.toThrow("Review request did not return parsed output");
  });

  it("should support minimal reasoning effort for GPT-5", async () => {
    const mockResponse = {
      output_parsed: { comments: [] },
    };

    const service = new AzureOpenAIService(mockConfig);
    const parseMock = vi.fn().mockResolvedValue(mockResponse);
    type MockClient = {
      client: {
        responses: {
          parse: typeof parseMock;
        };
      };
    };
    (service as unknown as MockClient).client.responses.parse = parseMock;

    const minimalConfig: ReviewPromptConfig = {
      reasoningEffort: "minimal",
    };

    await service.runReviewPrompt(mockInput, minimalConfig);

    expect(parseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: "minimal" },
      })
    );
  });
});
