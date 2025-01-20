import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "child_process";
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

function getGitInfo(diffMode: string): GitInfo | null {
  const commitCount = Number(
    execSync("git rev-list --count HEAD").toString().trim()
  );

  let diff = "";
  // (A) Diff
  if (diffMode === "entire-pr") {
    // Compare PR base to HEAD
    const baseRef = process.env.GITHUB_BASE_REF; // branch name
    if (!baseRef) {
      core.info("No GITHUB_BASE_REF found; defaulting to HEAD~1 if possible.");
      if (commitCount > 1) {
        diff = execSync("git diff HEAD~1 HEAD").toString();
      }
    } else {
      diff = execSync(`git diff origin/${baseRef}...HEAD`).toString();
    }
  } else {
    // last-commit mode
    if (commitCount > 1) {
      // If there's more than 1 commit, we can do HEAD~1
      diff = execSync("git diff HEAD~1 HEAD").toString();
    } else {
      // Fallback: Only one commit in the branch—use entire PR diff or skip
      core.info("Only one commit found; falling back to entire PR diff.");
      const baseRef = process.env.GITHUB_BASE_REF;
      if (baseRef) {
        diff = execSync(`git diff origin/${baseRef}...HEAD`).toString();
      }
    }
  }

  // Early exit if no diff
  if (!diff) {
    core.info("No diff found.");
    return null;
  }

  core.debug(`Diff: ${diff}`);

  // (B) Last Commit Message
  const commitMessage = execSync("git log -1 --pretty=format:%B HEAD")
    .toString()
    .trim();

  core.info(`Commit Message: ${commitMessage}`);
  core.info(`Diff Length: ${diff.length}`);

  return { diff, commitMessage };
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
    const gitInfo = getGitInfo(diffMode);
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
