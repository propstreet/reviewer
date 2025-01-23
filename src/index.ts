import * as core from "@actions/core";
import {
  isValidDiffMode,
  isValidSeverityLevel,
  isValidReasoningEffort,
  isValidTokenLimit,
  isValidCommitLimit,
} from "./validators.js";
import { review } from "./reviewer.js";

export async function run(): Promise<void> {
  try {
    // 1. Validate Inputs
    const diffMode = core.getInput("diffMode") || "last-commit";
    if (!isValidDiffMode(diffMode)) {
      core.setFailed(`Invalid diff mode: ${diffMode}`);
      return;
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

    // 2. Run Reviewer
    await review({
      githubToken,
      diffMode,
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
