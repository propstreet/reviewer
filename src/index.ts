import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  isValidDiffMode,
  isValidSeverityLevel,
  isValidReasoningEffort,
  isValidTokenLimit,
} from "./validators.js";
import { isWithinTokenLimit } from "gpt-tokenizer";
import {
  AzureOpenAIService,
  type AzureOpenAIConfig,
  type ReviewPromptConfig,
} from "./azureOpenAIService.js";
import { GitHubService } from "./githubService.js";

async function getDiff(
  githubService: GitHubService,
  diffMode: string,
  tokenLimit: number
): Promise<string | null> {
  try {
    const { commitMessage, patches } =
      diffMode === "entire-pr"
        ? await githubService.getEntirePRDiff()
        : await githubService.getLastCommitDiff();

    if (!patches.length) {
      core.info("No patches returned from GitHub.");
      return null;
    }

    const diffHeader = `# ${commitMessage}\n`;
    let finalDiff = "";
    let patchesUsed = 0;
    let patchesSkipped = 0;

    for (const p of patches) {
      const patchBlock = `\n## ${p.filename}\n\`\`\`diff\n${p.patch}\`\`\`\n`;
      // Check if we can add this patch without exceeding limit
      const combinedPreview = diffHeader + finalDiff + patchBlock;
      // isWithinTokenLimit returns false if limit exceeded
      const check = isWithinTokenLimit(combinedPreview, tokenLimit);
      if (!check) {
        // If this patch can't fit
        if (patchesUsed === 0) {
          // If even the first patch doesn't fit, log warning and skip LLM
          core.warning(
            `First patch (${p.filename}) is too large, skipping AI completion.`
          );
          return null;
        } else {
          // Otherwise skip adding this patch
          patchesSkipped++;
          continue;
        }
      }
      // If within limit, add it
      finalDiff += patchBlock;
      patchesUsed++;
    }

    if (patchesSkipped > 0) {
      core.warning(
        `${patchesSkipped} patches did not fit within tokenLimit = ${tokenLimit}.`
      );
    }

    // If no patches fit at all
    if (patchesUsed === 0) {
      return null;
    }

    const diff = diffHeader + finalDiff;
    const tokenCount = isWithinTokenLimit(diff, tokenLimit);

    core.info(`Commit Message: ${commitMessage}`);
    core.info(`Diff Length: ${diff.length}, Token Count: ${tokenCount}`);
    core.info(
      `Patches Used: ${patchesUsed}, Patches Skipped: ${patchesSkipped}`
    );

    return diff;
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

    const tokenLimitInput = core.getInput("tokenLimit") || "200000";
    if (!isValidTokenLimit(tokenLimitInput)) {
      core.setFailed(`Invalid token limit: ${tokenLimitInput}`);
      return;
    }
    const tokenLimit = parseInt(tokenLimitInput, 10);

    // 2. Get Git Diff
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      core.setFailed("Missing GITHUB_TOKEN in environment.");
      return;
    }

    const { owner, repo, number: pull_number } = github.context.issue;
    const githubService = new GitHubService({
      token,
      owner,
      repo,
      pullNumber: pull_number,
    });

    const diff = await getDiff(githubService, diffMode, tokenLimit);
    if (!diff) {
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

    const response = await azureService.runReviewPrompt(diff, reviewConfig);

    if (!response?.comments || response.comments.length === 0) {
      core.info("No suggestions from AI.");
      return;
    }

    core.info(`Got ${response.comments.length} suggestions from AI.`);

    // 4. Post Comments to PR
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
