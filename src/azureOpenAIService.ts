import { AzureOpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { CodeReviewCommentArray } from "./schemas.js";
import type { ReasoningEffort } from "./validators.js";

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}

export interface ReviewPromptConfig {
  reasoningEffort: ReasoningEffort;
}

export type ReviewResult = {
  comments: Array<{
    sha: string;
    file: string;
    line: number;
    side: "LEFT" | "RIGHT";
    comment: string;
    severity: "info" | "warning" | "error";
  }>;
};

export class AzureOpenAIService {
  private client: AzureOpenAI;
  private deployment: string;

  constructor(config: AzureOpenAIConfig) {
    this.client = new AzureOpenAI({
      endpoint: config.endpoint,
      deployment: config.deployment,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
    });
    this.deployment = config.deployment;
  }

  async runReviewPrompt(
    prompt: string,
    config: ReviewPromptConfig
  ): Promise<ReviewResult> {
    const system = `You are a helpful code reviewer. Review this pull request and provide any suggestions.
Each comment must include the associated commit sha, file, line, side and severity: 'info', 'warning', or 'error'.
Only comment on lines that need improvement. Comments may be formatted as markdown.
If you have no comments, return an empty comments array. Respond in JSON format.`;

    const input = `${system}\n\n${prompt}`;

    const response = await this.client.responses.parse({
      model: this.deployment,
      input,
      reasoning: { effort: config.reasoningEffort },
      response_format: zodResponseFormat(
        CodeReviewCommentArray,
        "review_comments"
      ),
    });

    if (!response.output_parsed) {
      throw new Error("Review request did not finish");
    }

    return response.output_parsed;
  }
}
