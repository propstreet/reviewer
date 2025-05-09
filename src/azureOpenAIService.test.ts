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

    expect(parseMock).toHaveBeenCalled();
    const callArgs = parseMock.mock.calls[0][0];
    expect(callArgs.model).toBe("");
    expect(callArgs.reasoning_effort).toBe(mockReviewConfig.reasoningEffort);

    expect(callArgs.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "developer",
          content: expect.any(String),
        }),
        expect.objectContaining({
          role: "user",
          content: mockInput,
        }),
      ])
    );

    expect(callArgs.response_format.type).toBe("json_schema");
    expect(callArgs.response_format.json_schema.name).toBe("review_comments");
    expect(callArgs.response_format.json_schema.strict).toBe(true);
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
