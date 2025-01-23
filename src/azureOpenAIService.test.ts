import {
  AzureOpenAIService,
  type AzureOpenAIConfig,
  type ReviewPromptConfig,
} from "./azureOpenAIService.js";
import { AzureOpenAI } from "openai";

// Mock the OpenAI client
vi.mock("openai", () => ({
  AzureOpenAI: vi.fn().mockImplementation(() => ({
    beta: {
      chat: {
        completions: {
          parse: vi.fn(),
        },
      },
    },
  })),
}));

describe("AzureOpenAIService", () => {
  const mockConfig: AzureOpenAIConfig = {
    endpoint: "https://AZURE_ENDPOINT",
    deployment: "AZURE_DEPLOYMENT",
    apiKey: "AZURE_API_KEY",
    apiVersion: "2024-12-01-preview",
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
      choices: [
        {
          finish_reason: "stop",
          message: {
            parsed: {
              comments: [
                {
                  file: "test.ts",
                  line: 1,
                  comment: "Test comment",
                  severity: "info",
                },
              ],
            },
          },
        },
      ],
    };

    const service = new AzureOpenAIService(mockConfig);
    const parseMock = vi.fn().mockResolvedValue(mockResponse);
    type MockClient = {
      client: {
        beta: {
          chat: {
            completions: {
              parse: typeof parseMock;
            };
          };
        };
      };
    };
    (service as unknown as MockClient).client.beta.chat.completions.parse =
      parseMock;

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
      model: "",
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "developer",
          content: expect.any(String),
        }),
        expect.objectContaining({
          role: "user",
          content: mockInput,
        }),
      ]),
      response_format: expectedSchema,
      reasoning_effort: mockReviewConfig.reasoningEffort,
    });
    expect(result).toEqual(mockResponse.choices[0].message.parsed);
  });

  it("should throw error when review does not finish successfully", async () => {
    const mockResponse = {
      choices: [
        {
          finish_reason: "length",
          message: {
            parsed: null,
          },
        },
      ],
    };

    const service = new AzureOpenAIService(mockConfig);
    const parseMock = vi.fn().mockResolvedValue(mockResponse);
    type MockClient = {
      client: {
        beta: {
          chat: {
            completions: {
              parse: typeof parseMock;
            };
          };
        };
      };
    };
    (service as unknown as MockClient).client.beta.chat.completions.parse =
      parseMock;

    await expect(
      service.runReviewPrompt(mockInput, mockReviewConfig)
    ).rejects.toThrow("Review request did not finish, got length");
  });
});
