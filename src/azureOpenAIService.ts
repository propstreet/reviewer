import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { CodeReviewCommentArray, type ReviewResult } from "./schemas.js";
import type { ReasoningEffort } from "./validators.js";

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiKey: string;
}

export interface ReviewPromptConfig {
  reasoningEffort: ReasoningEffort;
  customPrompt?: string;
}

export class AzureOpenAIService {
  private client: OpenAI;
  private deployment: string;

  constructor(config: AzureOpenAIConfig) {
    // Use standard OpenAI client with Azure v1 endpoint
    // Format: {endpoint}/openai/v1 with api-version=preview
    const baseUrl = config.endpoint.endsWith("/")
      ? `${config.endpoint}openai/v1`
      : `${config.endpoint}/openai/v1`;

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: baseUrl,
      defaultQuery: { "api-version": "preview" },
      defaultHeaders: { "api-key": config.apiKey },
    });
    this.deployment = config.deployment;
  }

  async runReviewPrompt(
    prompt: string,
    config: ReviewPromptConfig
  ): Promise<ReviewResult> {
    const baseInstructions = `You are a helpful code reviewer. Review this pull request and provide any suggestions.
Each comment must include: sha, file, start_line, start_side, line, side, comment, and severity ('info', 'warning', or 'error').
For single-line comments: set start_line = line and start_side = side.
For multi-line comments: start_line/start_side is the first line, line/side is the last line.
Only comment on lines that need improvement. Comments may be formatted as markdown.
If you have no comments, return an empty comments array. Respond in JSON format.`;

    const instructions = config.customPrompt
      ? `${baseInstructions}\n\nAdditional instructions: ${config.customPrompt}`
      : baseInstructions;

    const response = await this.client.responses.parse({
      model: this.deployment,
      instructions: instructions,
      input: prompt,
      reasoning: { effort: config.reasoningEffort },
      text: {
        format: zodTextFormat(CodeReviewCommentArray, "review_comments"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("Review request did not return parsed output");
    }

    return response.output_parsed;
  }
}
