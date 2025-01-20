import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  isValidDiffMode,
  isValidSeverityLevel,
  isValidReasoningEffort,
} from "./validators.js";
import {
  AzureOpenAIService,
  type AzureOpenAIConfig,
  type ReviewPromptConfig,
} from "./azureOpenAIService.js";
import { GitHubService, type GitHubConfig } from "./githubService.js";

interface GitInfo {
  diff: string;
  commitMessage: string;
}

async function getGitInfo(diffMode: string): Promise<GitInfo | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    core.info("No GitHub token found, returning null.");
    return null;
  }

  const { owner, repo, number: pull_number } = github.context.issue;
  const githubService = new GitHubService({
    token,
    owner,
    repo,
    pullNumber: pull_number,
  });

  try {
    if (diffMode === "entire-pr") {
      const { commitMessage, patches } = await githubService.getEntirePRDiff();
      if (!patches.length) {
        core.info("No patches found for entire-pr mode.");
        return null;
      }
      const combinedDiff = patches
        .map((p) => `File: ${p.filename}\n${p.patch}`)
        .join("\n\n");
      core.debug(`Diff: ${combinedDiff}`);
      core.info(`Commit Message: ${commitMessage}`);
      core.info(`Diff Length: ${combinedDiff.length}`);
      return { diff: combinedDiff, commitMessage };
    } else {
      const { commitMessage, patches } =
        await githubService.getLastCommitDiff();
      if (!patches.length) {
        core.info("No patches found for last-commit mode.");
        return null;
      }
      const combinedDiff = patches
        .map((p) => `File: ${p.filename}\n${p.patch}`)
        .join("\n\n");
      core.debug(`Diff: ${combinedDiff}`);
      core.info(`Commit Message: ${commitMessage}`);
      core.info(`Diff Length: ${combinedDiff.length}`);
      return { diff: combinedDiff, commitMessage };
    }
  } catch (error) {
    core.error(
      `Failed to get git info: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export async function run(): Promise<void> {
  try {
    // 1. Validate Inputs
    const diffMode = core.getInput("diffMode") || "last-commit";
    if (!isValidDiffMode(diffMode)) {
      core.setFailed(`Invalid diff mode: ${diffMode}`);
      return;
    }

    const severityThreshold = core.getInput("severity") || "info";
    if (!isValidSeverityLevel(severityThreshold)) {
      core.setFailed(`Invalid severity: ${severityThreshold}`);
      return;
    }

    const reasoningEffort = core.getInput("reasoningEffort") || "medium";
    if (!isValidReasoningEffort(reasoningEffort)) {
      core.setFailed(`Invalid reasoning effort: ${reasoningEffort}`);
      return;
    }

    // 2. Get Git Info
    const gitInfo = await getGitInfo(diffMode);
    if (!gitInfo) {
      return;
    }

    // 3. Setup Azure OpenAI Service
    const azureConfig: AzureOpenAIConfig = {
      endpoint: core.getInput("azureOpenAIEndpoint"),
      deployment: core.getInput("azureOpenAIDeployment"),
      apiKey: core.getInput("azureOpenAIKey"),
      apiVersion: core.getInput("azureOpenAIVersion") || "2024-12-01-preview",
    };

    const reviewConfig: ReviewPromptConfig = {
      severityThreshold,
      reasoningEffort,
    };

    const azureService = new AzureOpenAIService(azureConfig);
    core.info("Calling Azure OpenAI...");

    const response = await azureService.runReviewPrompt(
      {
        commitMessage: gitInfo.commitMessage,
        diff: gitInfo.diff,
      },
      reviewConfig
    );

    if (!response?.comments || response.comments.length === 0) {
      core.info("No suggestions from AI.");
      return;
    }

    core.info(`Got ${response.comments.length} suggestions from AI.`);

    // 4. Post Comments to PR
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      core.setFailed("Missing GITHUB_TOKEN in environment.");
      return;
    }

    const { owner, repo, number: pull_number } = github.context.issue;
    const githubConfig: GitHubConfig = {
      token,
      owner,
      repo,
      pullNumber: pull_number,
    };

    const githubService = new GitHubService(githubConfig);
    const result = await githubService.postReviewComments(
      response.comments,
      severityThreshold
    );

    if (result.skipped) {
      if (result.reason) {
        core.info(result.reason);
      }
    } else if (result.commentsPosted) {
      core.info(`Posted ${result.commentsPosted} comments`);
      if (result.commentsFiltered && result.commentsFiltered > 0) {
        core.info(
          `Filtered out ${result.commentsFiltered} comments below severity threshold.`
        );
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

run();
