import * as core from "@actions/core";
import * as github from "@actions/github";
import { DiffMode, SeverityLevel } from "./validators.js";
import { isWithinTokenLimit } from "gpt-tokenizer";
import {
  AzureOpenAIService,
  type ReasoningEffort,
  type AzureOpenAIConfig,
} from "./azureOpenAIService.js";
import { GitHubService, PatchInfo } from "./githubService.js";

async function getDiff(
  githubService: GitHubService,
  diffMode: string,
  tokenLimit: number
) {
  try {
    const diff =
      diffMode === "entire-pr"
        ? await githubService.getEntirePRDiff()
        : await githubService.getLastCommitDiff();

    if (!diff?.patches || diff.patches.length === 0) {
      core.info("No patches returned from GitHub.");
      return null;
    }

    const diffHeader = `# ${diff.commitMessage}\n`;
    let finalDiff = "";
    const skippedPatches: PatchInfo[] = [];
    const usedPatches: PatchInfo[] = [];

    for (const p of diff.patches) {
      const patchBlock = `\n## ${p.filename}\n\`\`\`diff\n${p.patch}\`\`\`\n`;
      // Check if we can add this patch without exceeding limit
      const combinedPreview = diffHeader + finalDiff + patchBlock;
      // isWithinTokenLimit returns false if limit exceeded
      const check = isWithinTokenLimit(combinedPreview, tokenLimit);
      if (!check) {
        // Skip adding this patch
        skippedPatches.push(p);
        continue;
      }
      // If within limit, add it
      finalDiff += patchBlock;
      usedPatches.push(p);
    }

    if (usedPatches.length === 0) {
      core.warning("No patches fit within token limit.");
      return null;
    } else if (skippedPatches.length > 0) {
      core.warning(
        `${skippedPatches.length} patches did not fit within tokenLimit = ${tokenLimit}.`
      );
    }

    const combined = diffHeader + finalDiff;
    const tokenCount = isWithinTokenLimit(combined, tokenLimit);

    core.info(`Commit Message: ${diff.commitMessage}`);
    core.info(`Diff Length: ${combined.length}, Token Count: ${tokenCount}`);
    core.info(
      `Patches Used: ${usedPatches.length}, Patches Skipped: ${skippedPatches.length}`
    );

    return {
      combined,
      commitSha: diff.commitSha,
      patches: usedPatches,
    };
  } catch (error) {
    core.error(
      `Failed to get git info: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export type ReviewOptions = {
  githubToken: string;
  diffMode: DiffMode;
  tokenLimit: number;
  changesThreshold: SeverityLevel;
  reasoningEffort: ReasoningEffort;
};

export async function review(options: ReviewOptions) {
  const { owner, repo, number: pull_number } = github.context.issue;
  const githubService = new GitHubService({
    token: options.githubToken,
    owner,
    repo,
    pullNumber: pull_number,
  });

  const diff = await getDiff(
    githubService,
    options.diffMode,
    options.tokenLimit
  );
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

  const azureService = new AzureOpenAIService(azureConfig);
  core.info("Calling Azure OpenAI...");

  const response = await azureService.runReviewPrompt(diff.combined, {
    reasoningEffort: options.reasoningEffort,
  });

  if (!response?.comments || response.comments.length === 0) {
    core.info("No suggestions from AI.");
    return;
  }

  core.info(`Got ${response.comments.length} suggestions from AI.`);

  // 4. Post Comments to PR
  const result = await githubService.postReviewComments(
    response.comments,
    options.changesThreshold,
    diff.commitSha,
    diff.patches
  );

  core.info(
    `Posted ${result.reviewComments} comments and requested ${result.reviewChanges} changes.`
  );
}
