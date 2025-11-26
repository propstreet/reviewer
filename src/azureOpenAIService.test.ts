import {
  AzureOpenAIService,
  type AzureOpenAIConfig,
  type ReviewPromptConfig,
  type BackgroundPollingConfig,
} from "./azureOpenAIService.js";
import OpenAI from "openai";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}));

// Mock the OpenAI client using vitest 4.x vi.fn(class) pattern
const mockParse = vi.fn();
const mockCreate = vi.fn();
const mockRetrieve = vi.fn();
const mockCancel = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(
    class MockOpenAI {
      responses = {
        parse: mockParse,
        create: mockCreate,
        retrieve: mockRetrieve,
        cancel: mockCancel,
      };
    }
  ),
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

    mockParse.mockResolvedValue(mockResponse);
    const service = new AzureOpenAIService(mockConfig);

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

    expect(mockParse).toHaveBeenCalledWith({
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

    mockParse.mockResolvedValue(mockResponse);
    const service = new AzureOpenAIService(mockConfig);

    await expect(
      service.runReviewPrompt(mockInput, mockReviewConfig)
    ).rejects.toThrow("Review request did not return parsed output");
  });

  it("should support minimal reasoning effort for GPT-5", async () => {
    const mockResponse = {
      output_parsed: { comments: [] },
    };

    mockParse.mockResolvedValue(mockResponse);
    const service = new AzureOpenAIService(mockConfig);

    const minimalConfig: ReviewPromptConfig = {
      reasoningEffort: "minimal",
    };

    await service.runReviewPrompt(mockInput, minimalConfig);

    expect(mockParse).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: "minimal" },
      })
    );
  });

  describe("Background Mode", () => {
    const backgroundPollingConfig: BackgroundPollingConfig = {
      enabled: true,
      maxWaitTimeMs: 60000, // 1 minute for tests
      initialIntervalMs: 10, // 10ms for fast tests
      maxIntervalMs: 100, // 100ms cap for tests
      backoffMultiplier: 1.5,
    };

    const mockConfigWithBackground: ReviewPromptConfig = {
      reasoningEffort: "high",
      backgroundPolling: backgroundPollingConfig,
    };

    it("should use background mode when enabled", async () => {
      // Initial response with queued status
      mockCreate.mockResolvedValue({
        id: "resp_123",
        status: "queued",
      });

      // Retrieve returns completed with output
      mockRetrieve.mockResolvedValue({
        id: "resp_123",
        status: "completed",
        output: [
          {
            type: "text",
            text: JSON.stringify({
              comments: [
                {
                  sha: "abc123",
                  file: "test.ts",
                  line: 1,
                  side: "RIGHT",
                  start_line: 1,
                  start_side: "RIGHT",
                  comment: "Test comment",
                  severity: "info",
                },
              ],
            }),
          },
        ],
      });

      const service = new AzureOpenAIService(mockConfig);
      const result = await service.runReviewPrompt(
        mockInput,
        mockConfigWithBackground
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          background: true,
          store: true,
        })
      );
      expect(mockRetrieve).toHaveBeenCalledWith("resp_123");
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].sha).toBe("abc123");
    });

    it("should poll until completion with multiple status checks", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_456",
        status: "queued",
      });

      // First call: in_progress, Second call: completed
      mockRetrieve
        .mockResolvedValueOnce({
          id: "resp_456",
          status: "in_progress",
        })
        .mockResolvedValueOnce({
          id: "resp_456",
          status: "completed",
          output: [
            {
              type: "text",
              text: JSON.stringify({ comments: [] }),
            },
          ],
        });

      const service = new AzureOpenAIService(mockConfig);
      const result = await service.runReviewPrompt(
        mockInput,
        mockConfigWithBackground
      );

      expect(mockRetrieve).toHaveBeenCalledTimes(2);
      expect(result.comments).toHaveLength(0);
    });

    it("should throw error on failed status", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_789",
        status: "queued",
      });

      mockRetrieve.mockResolvedValue({
        id: "resp_789",
        status: "failed",
        error: { message: "Model error occurred" },
      });

      const service = new AzureOpenAIService(mockConfig);

      await expect(
        service.runReviewPrompt(mockInput, mockConfigWithBackground)
      ).rejects.toThrow("Review request failed: Model error occurred");
    });

    it("should throw error on cancelled status", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_abc",
        status: "queued",
      });

      mockRetrieve.mockResolvedValue({
        id: "resp_abc",
        status: "cancelled",
      });

      const service = new AzureOpenAIService(mockConfig);

      await expect(
        service.runReviewPrompt(mockInput, mockConfigWithBackground)
      ).rejects.toThrow("Review request was cancelled");
    });

    it("should throw error on incomplete status", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_def",
        status: "queued",
      });

      mockRetrieve.mockResolvedValue({
        id: "resp_def",
        status: "incomplete",
        incomplete_details: { reason: "max_tokens" },
      });

      const service = new AzureOpenAIService(mockConfig);

      await expect(
        service.runReviewPrompt(mockInput, mockConfigWithBackground)
      ).rejects.toThrow("Review request incomplete: max_tokens");
    });

    it("should timeout and cancel request after max wait time", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_timeout",
        status: "queued",
      });

      // Always return in_progress to trigger timeout
      mockRetrieve.mockResolvedValue({
        id: "resp_timeout",
        status: "in_progress",
      });

      mockCancel.mockResolvedValue({ id: "resp_timeout", status: "cancelled" });

      const shortTimeoutConfig: ReviewPromptConfig = {
        reasoningEffort: "high",
        backgroundPolling: {
          enabled: true,
          maxWaitTimeMs: 50, // Very short timeout for test
          initialIntervalMs: 10,
          maxIntervalMs: 20,
          backoffMultiplier: 1.5,
        },
      };

      const service = new AzureOpenAIService(mockConfig);

      await expect(
        service.runReviewPrompt(mockInput, shortTimeoutConfig)
      ).rejects.toThrow(/Background review timed out/);

      expect(mockCancel).toHaveBeenCalledWith("resp_timeout");
    });

    it("should throw error when no text output in response", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_notext",
        status: "queued",
      });

      mockRetrieve.mockResolvedValue({
        id: "resp_notext",
        status: "completed",
        output: [], // Empty output
      });

      const service = new AzureOpenAIService(mockConfig);

      await expect(
        service.runReviewPrompt(mockInput, mockConfigWithBackground)
      ).rejects.toThrow("Review request did not return text output");
    });

    it("should throw error on invalid JSON in response", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_badjson",
        status: "queued",
      });

      mockRetrieve.mockResolvedValue({
        id: "resp_badjson",
        status: "completed",
        output: [
          {
            type: "text",
            text: "{ invalid json",
          },
        ],
      });

      const service = new AzureOpenAIService(mockConfig);

      await expect(
        service.runReviewPrompt(mockInput, mockConfigWithBackground)
      ).rejects.toThrow("Invalid JSON in AI response");
    });

    it("should retry on transient polling errors", async () => {
      mockCreate.mockResolvedValue({
        id: "resp_retry",
        status: "queued",
      });

      // First call: transient error, Second call: completed
      mockRetrieve
        .mockRejectedValueOnce({ status: 503, message: "Service unavailable" })
        .mockResolvedValueOnce({
          id: "resp_retry",
          status: "completed",
          output: [
            {
              type: "text",
              text: JSON.stringify({ comments: [] }),
            },
          ],
        });

      const service = new AzureOpenAIService(mockConfig);
      const result = await service.runReviewPrompt(
        mockInput,
        mockConfigWithBackground
      );

      expect(mockRetrieve).toHaveBeenCalledTimes(2);
      expect(result.comments).toHaveLength(0);
    });
  });
});
