import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  isValidSeverityLevel,
  isValidReasoningEffort,
  isValidTokenLimit,
  isValidExcludePatterns,
  isValidCommitLimit,
  isValidAzureEndpoint,
  isValidAzureDeployment,
  isValidAzureApiKey,
  isValidCustomPrompt,
  isValidBackgroundMode,
  isValidBackgroundMaxWait,
  isValidBackgroundPollInterval,
  BACKGROUND_MAX_INTERVAL_MS,
  BACKGROUND_BACKOFF_MULTIPLIER,
} from "./validators.js";
import type { BackgroundPollingConfig } from "./azureOpenAIService.js";
import { ReviewService } from "./reviewer.js";
import { GitHubService } from "./githubService.js";
import { AzureOpenAIService } from "./azureOpenAIService.js";
import {
  SUPPORTED_ACTIONS,
  isPrBasedAction,
  isSupportedAction,
} from "./constants.js";

export async function run(): Promise<void> {
  try {
    // 1. Validate Inputs
    const excludePatternsInput = core.getInput("exclude") || "";
    if (!isValidExcludePatterns(excludePatternsInput)) {
      core.setFailed(`Invalid exclude patterns: ${excludePatternsInput}`);
      return;
    }
    const excludePatterns = excludePatternsInput
      ? excludePatternsInput.split(",").map((p) => p.trim())
      : [];

    const customPrompt = core.getInput("customPrompt") || "";
    if (!isValidCustomPrompt(customPrompt)) {
      core.setFailed("Invalid custom prompt: must be 1000 characters or less");
      return;
    }

    // Background mode configuration
    const backgroundModeInput = core.getInput("backgroundMode") || "disabled";
    if (!isValidBackgroundMode(backgroundModeInput)) {
      core.setFailed(
        `Invalid backgroundMode: ${backgroundModeInput}. Must be 'enabled' or 'disabled'.`
      );
      return;
    }

    // Build background polling config (only validate params when enabled)
    let backgroundPolling: BackgroundPollingConfig | undefined;
    if (backgroundModeInput === "enabled") {
      const backgroundMaxWaitInput = core.getInput("backgroundMaxWait") || "30";
      if (!isValidBackgroundMaxWait(backgroundMaxWaitInput)) {
        core.setFailed(
          `Invalid backgroundMaxWait: ${backgroundMaxWaitInput}. Must be 1-60 minutes.`
        );
        return;
      }

      const backgroundPollIntervalInput =
        core.getInput("backgroundPollInterval") || "10";
      if (!isValidBackgroundPollInterval(backgroundPollIntervalInput)) {
        core.setFailed(
          `Invalid backgroundPollInterval: ${backgroundPollIntervalInput}. Must be 5-60 seconds.`
        );
        return;
      }

      backgroundPolling = {
        enabled: true,
        maxWaitTimeMs: parseInt(backgroundMaxWaitInput, 10) * 60 * 1000,
        initialIntervalMs: parseInt(backgroundPollIntervalInput, 10) * 1000,
        maxIntervalMs: BACKGROUND_MAX_INTERVAL_MS,
        backoffMultiplier: BACKGROUND_BACKOFF_MULTIPLIER,
      };
    }

    const changesThreshold = core.getInput("severity") || "error";
    if (!isValidSeverityLevel(changesThreshold)) {
      core.setFailed(`Invalid severity: ${changesThreshold}`);
      return;
    }

    const reasoningEffort = core.getInput("reasoningEffort") || "medium";
    if (!isValidReasoningEffort(reasoningEffort)) {
      core.setFailed(`Invalid reasoning effort: ${reasoningEffort}`);
      return;
    }

    const tokenLimitInput = core.getInput("tokenLimit") || "50000";
    if (!isValidTokenLimit(tokenLimitInput)) {
      core.setFailed(`Invalid token limit: ${tokenLimitInput}`);
      return;
    }
    const tokenLimit = parseInt(tokenLimitInput, 10);

    const commitLimitInput = core.getInput("commitLimit") || "100";
    if (!isValidCommitLimit(commitLimitInput)) {
      core.setFailed(`Invalid commit limit: ${commitLimitInput}`);
      return;
    }
    const commitLimit = parseInt(commitLimitInput, 10);

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      core.setFailed("Missing GITHUB_TOKEN in environment.");
      return;
    }
    core.setSecret(githubToken); // Mask token in logs

    // Validate Azure-related inputs
    const azureOpenAIEndpoint = core.getInput("azureOpenAIEndpoint");
    if (!isValidAzureEndpoint(azureOpenAIEndpoint)) {
      core.setFailed(`Invalid Azure OpenAI endpoint: ${azureOpenAIEndpoint}`);
      return;
    }

    const azureOpenAIDeployment = core.getInput("azureOpenAIDeployment");
    if (!isValidAzureDeployment(azureOpenAIDeployment)) {
      core.setFailed(
        `Invalid Azure OpenAI deployment: ${azureOpenAIDeployment}`
      );
      return;
    }

    const azureOpenAIKey = core.getInput("azureOpenAIKey");
    if (!isValidAzureApiKey(azureOpenAIKey)) {
      core.setFailed("Invalid Azure OpenAI API key");
      return;
    }
    core.setSecret(azureOpenAIKey); // Treat the API key as a secret

    // Check the pull_request event in the payload
    const action = github.context.payload.action;
    // Trim inputs to treat whitespace-only as empty
    const baseInput = core.getInput("base").trim();
    const headInput = core.getInput("head").trim();
    let base = baseInput;
    let head = headInput;

    core.debug(`Detected action: ${action ?? "(none)"}`);
    core.debug(
      `Base input: ${base || "(none)"}, Head input: ${head || "(none)"}`
    );

    // If user hasn't explicitly given base/head, override from the event:
    if (!base && !head) {
      if (isPrBasedAction(action)) {
        base = github.context.payload.pull_request?.base?.sha;
        head = github.context.payload.pull_request?.head?.sha;
      } else if (action === "synchronize") {
        base = github.context.payload.before;
        head = github.context.payload.after;
      }
    }

    core.debug(`Resolved base: ${base || "(none)"}, head: ${head || "(none)"}`);

    if (!base || !head) {
      // Check for partial input configuration (user provided only one of base/head)
      const hasPartialInput =
        (baseInput && !headInput) || (!baseInput && headInput);
      let hint: string;

      if (hasPartialInput) {
        const provided = baseInput ? "base" : "head";
        const missing = baseInput ? "head" : "base";
        hint = `Only '${provided}' was provided; '${missing}' is also required. Provide both 'base' and 'head', or omit both to use auto-detection.`;
      } else if (action) {
        hint = isSupportedAction(action)
          ? `Detected action '${action}' which should be supported, but payload is missing required SHA fields.`
          : `Detected action '${action}' which is not auto-detected.`;
      } else {
        hint = "No action detected in payload.";
      }

      core.setFailed(
        `Missing base or head sha to review. ${hint} ` +
          `Supported auto-detection: ${SUPPORTED_ACTIONS.join(", ")}. ` +
          `Alternatively, provide explicit 'base' and 'head' inputs.`
      );
      return;
    }

    const { owner, repo, number: pullNumber } = github.context.issue;
    const githubService = new GitHubService({
      token: githubToken,
      owner,
      repo,
      pullNumber,
    });

    const azureService = new AzureOpenAIService({
      endpoint: azureOpenAIEndpoint,
      deployment: azureOpenAIDeployment,
      apiKey: azureOpenAIKey,
    });

    // 2. Run Reviewer
    const reviewerService = new ReviewService(githubService, azureService);
    await reviewerService.review({
      base,
      head,
      tokenLimit,
      changesThreshold,
      reasoningEffort,
      commitLimit,
      excludePatterns,
      customPrompt: customPrompt || undefined,
      backgroundPolling,
    });

    // 3. Done
    core.info("Review completed.");
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

// Only call run if we are not in a test environment
if (require.main) {
  run();
}
