import { AzureOpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { CodeReviewCommentArray } from "./schemas.js";
import { ChatCompletionReasoningEffort } from "openai/resources/index.mjs";

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}

export interface ReviewPromptConfig {
  severityThreshold: string;
  reasoningEffort: ChatCompletionReasoningEffort;
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

  async runReviewPrompt(diff: string, config: ReviewPromptConfig) {
    const completion = await this.client.beta.chat.completions.parse({
      model: "",
      messages: [
        {
          role: "developer",
          content: `You are a helpful code reviewer. Review this pull request and provide any suggestions.
Each comment must include a severity: 'info', 'warning', or 'error'. Skip any comments with severity less than '${config.severityThreshold}'.
Only comment on lines that need improvement. Comments may be formatted as markdown.
If you have no comments, return an empty comments array. Respond in JSON format.`,
        },
        {
          role: "user",
          content: diff,
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
