import {
  AzureOpenAIService,
  type AzureOpenAIConfig,
  type ReviewPromptConfig,
} from "./azureOpenAIService.js";
import { AzureOpenAI } from "openai";

// Mock the OpenAI client
vi.mock("openai", () => ({
  AzureOpenAI: vi.fn().mockImplementation(() => ({
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
    apiVersion: "2025-03-01-preview",
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
    expect(AzureOpenAI).toHaveBeenCalledExactlyOnceWith(mockConfig);
  });

  it("should handle successful review prompt", async () => {
    const mockResponse = {
      output_parsed: {
        comments: [
          {
            file: "test.ts",
            line: 1,
            comment: "Test comment",
            severity: "info",
            sha: "abc",
            side: "RIGHT",
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

    const expectedSchema = {
      json_schema: {
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
                      "The line of the blob in the pull request diff that the comment applies to.",
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
                      "In a split diff view, the side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context.",
                    enum: ["LEFT", "RIGHT"],
                    type: "string",
                  },
                },
                required: [
                  "sha",
                  "file",
                  "line",
                  "side",
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
      },
      type: "json_schema",
    };

    expect(parseMock).toHaveBeenCalledWith({
      model: mockConfig.deployment,
      input: expect.stringContaining(mockInput),
      reasoning: { effort: mockReviewConfig.reasoningEffort },
      response_format: expectedSchema,
    });
    expect(result).toEqual(mockResponse.output_parsed);
  });

  it("should throw error when review does not finish successfully", async () => {
    const mockResponse = {
      output_parsed: null,
      status: "length",
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
    ).rejects.toThrow("Review request did not finish, got length");
  });
});
