import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  isValidSeverityLevel,
  isValidReasoningEffort,
  isValidTokenLimit,
  isValidCommitLimit,
  isValidAzureEndpoint,
  isValidAzureDeployment,
  isValidAzureApiKey,
  isValidAzureApiVersion,
} from "./validators.js";
import { ReviewService } from "./reviewer.js";
import { GitHubService } from "./githubService.js";
import { AzureOpenAIService } from "./azureOpenAIService.js";

export async function run(): Promise<void> {
  try {
    // 1. Validate Inputs
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

    const azureOpenAIVersion =
      core.getInput("azureOpenAIVersion") || "2024-12-01-preview";
    if (!isValidAzureApiVersion(azureOpenAIVersion)) {
      core.setFailed(`Invalid Azure OpenAI API version: ${azureOpenAIVersion}`);
      return;
    }

    // Check the pull_request event in the payload
    const action = github.context.payload.action;
    let base = core.getInput("base"); // possibly empty
    let head = core.getInput("head"); // possibly empty

    // If user hasn't explicitly given base/head, override from the event:
    if (!base && !head) {
      if (action === "opened") {
        base = github.context.payload.pull_request?.base?.sha;
        head = github.context.payload.pull_request?.head?.sha;
      } else if (action === "synchronize") {
        base = github.context.payload.before;
        head = github.context.payload.after;
      }
    }

    if (!base || !head) {
      core.setFailed("Missing base or head sha to review.");
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
      apiVersion: azureOpenAIVersion,
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
