import { AzureOpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { CodeReviewCommentArray } from "./schemas.js";

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}

export type ReasoningEffort = "low" | "medium" | "high";

export interface ReviewPromptConfig {
  reasoningEffort: ReasoningEffort;
}

export class AzureOpenAIService {
  private client: AzureOpenAI;

  constructor(config: AzureOpenAIConfig) {
    this.client = new AzureOpenAI({
      endpoint: config.endpoint,
      deployment: config.deployment,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
    });
  }

  async runReviewPrompt(prompt: string, config: ReviewPromptConfig) {
    const completion = await this.client.beta.chat.completions.parse({
      model: "",
      messages: [
        {
          role: "developer",
          content: `You are a helpful code reviewer. Review this pull request and provide any suggestions.
Each comment must include the associated commit sha, file, line, side and severity: 'info', 'warning', or 'error'.
Only comment on lines that need improvement. Comments may be formatted as markdown.
If you have no comments, return an empty comments array. Respond in JSON format.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: zodResponseFormat(
        CodeReviewCommentArray,
        "review_comments"
      ),
      reasoning_effort: config.reasoningEffort,
    });

    if (completion.choices[0].finish_reason !== "stop") {
      throw new Error(
        `Review request did not finish, got ${completion.choices[0].finish_reason}`
      );
    }

    return completion.choices[0].message.parsed;
  }
}
