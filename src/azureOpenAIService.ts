import * as core from "@actions/core";
import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import { CodeReviewCommentArray, type ReviewResult } from "./schemas.js";
import { formatError, type ReasoningEffort } from "./validators.js";

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiKey: string;
}

export interface BackgroundPollingConfig {
  enabled: boolean;
  maxWaitTimeMs: number; // Default: 30 min (1800000)
  initialIntervalMs: number; // Default: 10s (10000)
  maxIntervalMs: number; // Cap at 30s (30000)
  backoffMultiplier: number; // Default: 1.5
}

export interface ReviewPromptConfig {
  reasoningEffort: ReasoningEffort;
  customPrompt?: string;
  backgroundPolling?: BackgroundPollingConfig;
}

const TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "incomplete",
] as const;

type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

function isTerminalStatus(
  status: string | null | undefined
): status is TerminalStatus {
  if (!status) return false;
  return TERMINAL_STATUSES.includes(status as TerminalStatus);
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

    // Check if background mode is enabled
    if (config.backgroundPolling?.enabled) {
      return this.runBackgroundRequest(prompt, instructions, config);
    }

    // Synchronous mode (default)
    return this.runSynchronousRequest(prompt, instructions, config);
  }

  private async runSynchronousRequest(
    prompt: string,
    instructions: string,
    config: ReviewPromptConfig
  ): Promise<ReviewResult> {
    const maxRetries = 3;
    const initialDelayMs = 1000;
    const maxDelayMs = 10000;
    const backoffMultiplier = 2;

    let lastError: unknown;
    let currentDelay = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
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
      } catch (error) {
        lastError = error;

        // Only retry on transient errors
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Don't retry if we've exhausted all attempts
        if (attempt >= maxRetries) {
          break;
        }

        core.warning(
          `Synchronous request failed with retryable error (attempt ${attempt + 1}/${maxRetries + 1}): ${formatError(error)}`
        );

        await this.sleep(currentDelay);
        currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
      }
    }

    // All retries exhausted
    throw lastError;
  }

  private async runBackgroundRequest(
    prompt: string,
    instructions: string,
    config: ReviewPromptConfig
  ): Promise<ReviewResult> {
    const pollingConfig = config.backgroundPolling!;

    core.info("Starting background review request...");
    core.info(
      `Maximum wait time: ${Math.round(pollingConfig.maxWaitTimeMs / 60000)} minutes`
    );

    // Create background request with store: true (required for background mode)
    const initialResponse = await this.client.responses.create({
      model: this.deployment,
      instructions: instructions,
      input: prompt,
      reasoning: { effort: config.reasoningEffort },
      text: {
        format: zodTextFormat(CodeReviewCommentArray, "review_comments"),
      },
      background: true,
      store: true,
    });

    core.info(`Background request initiated: ${initialResponse.id}`);
    core.info(`Initial status: ${initialResponse.status}`);

    // Check if already in terminal state (fast completion or immediate failure)
    if (isTerminalStatus(initialResponse.status)) {
      core.info(
        `Request reached terminal status '${initialResponse.status}' immediately, skipping polling`
      );
      return this.handleCompletedResponse(initialResponse);
    }

    // Poll until completion
    const completedResponse = await this.pollForCompletion(
      initialResponse.id,
      pollingConfig
    );

    // Handle terminal statuses
    return this.handleCompletedResponse(completedResponse);
  }

  private async pollForCompletion(
    responseId: string,
    config: BackgroundPollingConfig
  ): Promise<OpenAIResponse> {
    const startTime = Date.now();
    let currentInterval = config.initialIntervalMs;
    let attempts = 0;

    core.startGroup("Background Request Polling");

    try {
      while (true) {
        attempts++;

        // Check timeout
        const elapsed = Date.now() - startTime;
        if (elapsed > config.maxWaitTimeMs) {
          core.warning(
            `Polling timeout reached after ${Math.round(elapsed / 60000)} minutes`
          );
          await this.cancelBackgroundRequest(responseId);
          throw new Error(
            `Background review timed out after ${Math.round(elapsed / 60000)} minutes ` +
              `(${attempts} polling attempts). Consider increasing 'backgroundMaxWait' ` +
              `or reducing PR complexity with 'tokenLimit' or 'exclude' patterns.`
          );
        }

        // Retrieve response status
        let response: OpenAIResponse;
        try {
          response = await this.client.responses.retrieve(responseId);
        } catch (error) {
          // Retry on transient errors
          if (this.isRetryableError(error)) {
            core.warning(`Polling error (will retry): ${formatError(error)}`);
            await this.sleep(currentInterval);
            continue;
          }
          throw error;
        }

        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        core.info(
          `[${new Date().toISOString()}] Status check #${attempts}: ${response.status} (${elapsedSec}s elapsed)`
        );

        if (isTerminalStatus(response.status)) {
          core.info(
            `Review reached terminal status '${response.status}' after ${elapsedSec} seconds (${attempts} status checks)`
          );
          return response;
        }

        // Wait before next poll with exponential backoff
        await this.sleep(currentInterval);
        currentInterval = Math.min(
          currentInterval * config.backoffMultiplier,
          config.maxIntervalMs
        );
      }
    } finally {
      core.endGroup();
    }
  }

  private handleCompletedResponse(response: OpenAIResponse): ReviewResult {
    if (response.status === "failed") {
      const errorMsg = response.error?.message || "Unknown error during review";
      throw new Error(`Review request failed: ${errorMsg}`);
    }

    if (response.status === "cancelled") {
      throw new Error("Review request was cancelled");
    }

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason || "Unknown reason";
      throw new Error(`Review request incomplete: ${reason}`);
    }

    // Use SDK convenience property for text output
    const textContent = response.output_text;
    if (!textContent) {
      throw new Error("Review request did not return text output");
    }

    // Parse the JSON text with Zod
    try {
      const parsed = JSON.parse(textContent);
      const validated = CodeReviewCommentArray.parse(parsed);
      return validated;
    } catch (parseError) {
      // Log preview for debugging (truncated)
      const preview = textContent.substring(0, 500);
      core.debug(`Failed to parse response. Preview: ${preview}...`);

      if (parseError instanceof SyntaxError) {
        throw new Error(`Invalid JSON in AI response: ${parseError.message}`);
      }
      throw new Error(
        `Failed to validate AI response: ${formatError(parseError)}`
      );
    }
  }

  private async cancelBackgroundRequest(responseId: string): Promise<void> {
    try {
      await this.client.responses.cancel(responseId);
      core.info(`Cancelled background request ${responseId}`);
    } catch (error) {
      core.warning(
        `Failed to cancel background request: ${formatError(error)}`
      );
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === "object" && "status" in error) {
      const status = (error as { status: number }).status;
      // Retry on rate limits, server errors, and timeouts
      const retryableCodes = [408, 429, 500, 502, 503, 504];
      return retryableCodes.includes(status);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
