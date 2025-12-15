import * as core from "@actions/core";
import { SeverityLevel, ReasoningEffort } from "./validators.js";
import { minimatch } from "minimatch";
import { isWithinTokenLimit } from "gpt-tokenizer/encoding/o200k_base";
import {
  AzureOpenAIService,
  BackgroundPollingConfig,
} from "./azureOpenAIService.js";
import { CommitDetails, GitHubService, PatchInfo } from "./githubService.js";

export type ReviewOptions = {
  base: string;
  head: string;
  tokenLimit: number;
  changesThreshold: SeverityLevel;
  reasoningEffort: ReasoningEffort;
  commitLimit: number;
  excludePatterns?: string[];
  customPrompt?: string;
  backgroundPolling?: BackgroundPollingConfig;
  skipMergeCommits?: boolean;
};

export type PackedCommit = {
  commit: CommitDetails;
  patches: PatchInfo[];
};

export type SkippedCommit = {
  sha: string;
  reason: "token_limit" | "all_excluded" | "not_in_pr" | "merge_commit";
};

export type BuildPromptResult = {
  prompt: string;
  commits: PackedCommit[];
  skippedCommits: SkippedCommit[];
  patches: PatchInfo[]; // Cumulative PR diff (base...HEAD) for validation
};

export const shouldExcludeFile = (
  filename: string,
  patterns: string[]
): string | false => {
  for (const pattern of patterns) {
    // Skip empty patterns or filenames
    if (!pattern || !filename) {
      continue;
    }
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
      continue;
    }
    if (minimatch(filename, trimmedPattern)) {
      return trimmedPattern;
    }
  }
  return false;
};

export class ReviewService {
  private githubService: GitHubService;
  private azureService: AzureOpenAIService;

  constructor(githubService: GitHubService, azureService: AzureOpenAIService) {
    this.githubService = githubService;
    this.azureService = azureService;
  }

  private packCommit(
    accumulated: string,
    commit: CommitDetails,
    tokenLimit: number,
    excludePatterns: string[] = []
  ) {
    core.debug(`Packing commit: ${commit.sha}`);

    let commitBlock = `\n## COMMIT SHA: ${commit.sha}\n\n${commit.message}\n`;
    const skippedPatches: PatchInfo[] = [];
    const usedPatches: PatchInfo[] = [];

    for (const p of commit.patches) {
      const excludePattern = shouldExcludeFile(p.filename, excludePatterns);
      if (excludePattern) {
        core.debug(
          `Skipping excluded file: ${p.filename} (matched pattern: ${excludePattern})`
        );
        skippedPatches.push(p);
        continue;
      }
      core.debug(`Packing patch: ${p.filename}`);

      const patchBlock = `\n### FILE: ${p.filename}\n\n\`\`\`diff\n${p.patch}\n\`\`\`\n`;
      // Check if we can add this patch without exceeding limit
      const combinedPreview = accumulated + commitBlock + patchBlock;
      // isWithinTokenLimit returns false if limit exceeded
      const check = isWithinTokenLimit(combinedPreview, tokenLimit);
      if (!check) {
        // Skip adding this patch
        core.debug(
          `Skipping patch ${p.filename} due to token limit ${tokenLimit}.`
        );
        skippedPatches.push(p);
        continue;
      }
      // If within limit, add it
      core.debug(`Adding patch ${p.filename} to commit block.`);
      commitBlock += patchBlock;
      usedPatches.push(p);
    }

    if (usedPatches.length === 0) {
      core.warning("No patches used in commit block.");
      return null;
    } else if (skippedPatches.length > 0) {
      core.warning(
        `${skippedPatches.length} patches were skipped due to exclusion patterns or token limit.`
      );
    }

    return {
      block: commitBlock,
      usedPatches,
      skippedPatches,
    };
  }

  private async buildPrompt(options: ReviewOptions) {
    const prDetails = await this.githubService.getPrDetails();
    core.debug(
      `Loaded PR #${prDetails.number} with ${prDetails.commitCount} commits.`
    );

    const results = await this.githubService.compareCommits(
      options.base,
      options.head
    );

    // If the head commit is missing from the compare results, fetch and push it silently.
    if (!results.commits.find((c) => c.sha === prDetails.head)) {
      const headCommit = await this.githubService.getCommitDetails(
        prDetails.head
      );
      results.commits.push(headCommit);
      core.debug(`Added missing head commit ${headCommit.sha} to results.`);
    }

    if (results.commits.length === 0) {
      core.info("No commits found to review.");
      return null;
    }

    // P3: Apply commitLimit - keep most recent commits
    let commitsToProcess = results.commits;
    if (results.commits.length > options.commitLimit) {
      const skippedCount = results.commits.length - options.commitLimit;
      core.info(
        `Limiting to ${options.commitLimit} most recent commits (${skippedCount} older commits skipped)`
      );
      commitsToProcess = results.commits.slice(-options.commitLimit);
    }

    core.info(
      `Building prompt for PR #${prDetails.number}: ${prDetails.title}`
    );
    let prompt = `# ${prDetails.title}\n`;

    if (prDetails.body) {
      prompt += `\n${prDetails.body}\n`;
    }

    const packedCommits: PackedCommit[] = [];
    const skippedCommits: SkippedCommit[] = [];

    for (const c of commitsToProcess) {
      core.debug(`Processing commit: ${c.sha}`);

      // Verify that the commit belongs to the current PR
      const belongs = await this.githubService.commitBelongsToPR(c.sha);
      if (!belongs) {
        core.info(
          `Skipping commit ${c.sha} as it does not belong to the current PR.`
        );
        skippedCommits.push({ sha: c.sha, reason: "not_in_pr" });
        continue;
      }

      // Get commit details (includes parentCount for merge detection)
      const commitDetails = await this.githubService.getCommitDetails(c.sha);

      // Skip merge commits - their diffs represent merge resolution, not actual changes,
      // and the merged-in changes have already been reviewed in their original PRs
      const skipMergeCommits = options.skipMergeCommits ?? true;
      if (skipMergeCommits && commitDetails.parentCount > 1) {
        core.info(
          `Skipping merge commit ${c.sha} - merged changes were reviewed in their original PRs.`
        );
        skippedCommits.push({ sha: c.sha, reason: "merge_commit" });
        continue;
      }

      core.debug(
        `Commit ${commitDetails.sha} has ${commitDetails.patches.length} patches. Message: ${commitDetails.message}`
      );
      const packed = this.packCommit(
        prompt,
        commitDetails,
        options.tokenLimit,
        options.excludePatterns
      );

      if (!packed) {
        core.warning(`Commit ${c.sha} was not packed into prompt.`);
        skippedCommits.push({ sha: c.sha, reason: "token_limit" });
        continue; // P1: was 'break' - now continues to process remaining commits
      }

      core.debug(
        `Patches Used: ${packed.usedPatches.length}, Patches Skipped: ${packed.skippedPatches.length}`
      );

      core.info(
        `Packed commit ${c.sha} with ${packed.usedPatches.length} patches into prompt.`
      );
      core.info(`Commit message: ${commitDetails.message}`);
      prompt += packed.block;
      packedCommits.push({
        commit: commitDetails,
        patches: packed.usedPatches,
      });
    }

    // Check token count - returns token count if within limit, false if exceeded
    const tokenCount = isWithinTokenLimit(prompt, options.tokenLimit);

    core.info(
      `Total Prompt Length: ${prompt.length} chars, Token Count: ${tokenCount === false ? "exceeded limit" : tokenCount}`
    );

    // Log skipped commits summary
    if (skippedCommits.length > 0) {
      core.warning(
        `${skippedCommits.length} commit(s) were skipped: ${skippedCommits.map((s) => `${s.sha.substring(0, 7)} (${s.reason})`).join(", ")}`
      );
    }

    return {
      prompt,
      commits: packedCommits,
      skippedCommits,
      patches: results.patches, // Cumulative PR diff for validation
    } satisfies BuildPromptResult;
  }

  async review(options: ReviewOptions) {
    const pr = await this.buildPrompt(options);
    if (!pr || !pr.commits || pr.commits.length === 0) {
      core.info("No commits found to review.");
      return false;
    }

    const mode = options.backgroundPolling?.enabled
      ? "Background (async)"
      : "Synchronous";
    core.info(`Calling Azure OpenAI... (Mode: ${mode})`);

    const response = await this.azureService.runReviewPrompt(pr.prompt, {
      reasoningEffort: options.reasoningEffort,
      customPrompt: options.customPrompt,
      backgroundPolling: options.backgroundPolling,
    });

    if (!response?.comments || response.comments.length === 0) {
      core.info("No suggestions from AI.");
      return false;
    }

    core.info(`Got ${response.comments.length} suggestions from AI.`);

    // 4. Post Comments to PR
    const result = await this.githubService.postReviewComments(
      response.comments,
      options.changesThreshold,
      pr.patches // Use cumulative PR diff for validation (matches GitHub's HEAD validation)
    );

    core.info(
      `Posted ${result.reviewComments} comments and requested ${result.reviewChanges} changes.`
    );

    return true;
  }
}
