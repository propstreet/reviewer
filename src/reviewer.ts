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
  skipMergeCommits: boolean;
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

export function generateSummaryComment(
  result: {
    reviewChanges: number;
    reviewComments: number;
    issueComments: number;
  },
  messageIndex?: number
): string {
  const totalIssues =
    result.reviewChanges + result.reviewComments + result.issueComments;

  if (totalIssues === 0) {
    const cleanMessages = [
      "## \u2728\uD83C\uDF89 Wow, this code is sparkling clean! \uD83C\uDF89\u2728\n\nI went through every nook and cranny and couldn't find a single issue. Either you're a coding genius or I need new glasses \uD83E\uDD13\uD83D\uDD0D\n\n\uD83D\uDE80 Ship it! This PR is ready to go! \uD83D\uDEA2\u2728",
      "## \uD83C\uDFC6 Flawless Victory! \uD83C\uDFC6\n\nZero issues found. Nada. Zilch. Nothing. \uD83E\uDD2F\n\nThis code is so clean it makes a fresh install look messy \uD83E\uDDF9\u2728\n\n\uD83D\uDC4F Great work! LGTM! \uD83D\uDE80",
      "## \uD83C\uDF1F Perfect Score! \uD83C\uDF1F\n\nI reviewed this PR and found... absolutely nothing wrong \uD83D\uDE31\n\nYou're making my job too easy! \uD83D\uDE04\uD83D\uDCAA\n\n\u2705 All clear, captain! Ready for liftoff! \uD83D\uDE80\uD83C\uDF15",
    ];
    const idx =
      messageIndex !== undefined
        ? messageIndex % cleanMessages.length
        : Math.floor(Math.random() * cleanMessages.length);
    return cleanMessages[idx];
  }

  // Build summary with issue breakdown
  let summary =
    "## \uD83D\uDD0D Review Complete! Here's the damage report \uD83D\uDCCB\n\n";

  if (totalIssues === 1) {
    summary += "Found **1** issue. Not bad, not bad at all! \uD83D\uDC4D\n\n";
  } else if (totalIssues <= 3) {
    summary += `Found **${totalIssues}** issues. Just a few things to tidy up! \uD83E\uDDF9\n\n`;
  } else if (totalIssues <= 10) {
    summary += `Found **${totalIssues}** issues. We've got some work to do! \uD83D\uDCAA\uD83D\uDE05\n\n`;
  } else {
    summary += `Found **${totalIssues}** issues. Buckle up, buttercup! \uD83C\uDF3B\uD83D\uDE48\n\n`;
  }

  // Breakdown
  const parts: string[] = [];
  if (result.reviewChanges > 0) {
    parts.push(`\u274C **${result.reviewChanges}** changes requested`);
  }
  if (result.reviewComments > 0) {
    parts.push(`\uD83D\uDCAC **${result.reviewComments}** comments`);
  }
  if (result.issueComments > 0) {
    parts.push(`\uD83D\uDCDD **${result.issueComments}** general comments`);
  }

  summary += parts.join(" | ") + "\n\n";

  if (result.reviewChanges > 0) {
    summary +=
      "\uD83D\uDEA8 Some changes were requested \u2014 please take a look and address them before merging! \uD83D\uDE4F\n";
  } else {
    summary +=
      "\uD83D\uDCA1 Just some suggestions \u2014 nothing blocking the merge! \uD83C\uDF89\n";
  }

  summary += "\n---\n*\uD83E\uDD16 Powered by Pro PR Reviewer*";

  return summary;
}

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
    const skipMergeCommits = options.skipMergeCommits;

    for (const c of commitsToProcess) {
      core.debug(`Processing commit: ${c.sha}`);

      // Skip merge commits early using parentCount from compareCommits
      // This avoids unnecessary getCommitDetails API calls for commits we'll skip
      if (skipMergeCommits && c.parentCount > 1) {
        core.info(
          `Skipping merge commit ${c.sha} - merged changes were reviewed in their original PRs.`
        );
        skippedCommits.push({ sha: c.sha, reason: "merge_commit" });
        continue;
      }

      // Verify that the commit belongs to the current PR
      const belongs = await this.githubService.commitBelongsToPR(c.sha);
      if (!belongs) {
        core.info(
          `Skipping commit ${c.sha} as it does not belong to the current PR.`
        );
        skippedCommits.push({ sha: c.sha, reason: "not_in_pr" });
        continue;
      }

      // Get commit details for patch extraction
      const commitDetails = await this.githubService.getCommitDetails(c.sha);

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

    // For validation, always use full PR diff (prDetails.base...prDetails.head)
    // This is necessary because GitHub validates review comments against the full PR diff,
    // not the narrow commit range we might be reviewing (e.g., for synchronize events)
    let validationPatches = results.patches;
    if (options.base !== prDetails.base || options.head !== prDetails.head) {
      core.debug(
        `Fetching full PR diff for validation: options=${options.base.substring(0, 7)}...${options.head.substring(0, 7)} vs PR=${prDetails.base.substring(0, 7)}...${prDetails.head.substring(0, 7)}`
      );
      const fullPrDiff = await this.githubService.compareCommits(
        prDetails.base,
        prDetails.head
      );
      validationPatches = fullPrDiff.patches;
    }

    return {
      prompt,
      commits: packedCommits,
      skippedCommits,
      patches: validationPatches, // Full PR diff for validation (matches GitHub's validation)
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

      // Post a clean summary comment
      const summaryBody = generateSummaryComment({
        reviewChanges: 0,
        reviewComments: 0,
        issueComments: 0,
      });
      try {
        await this.githubService.postSummaryComment(summaryBody);
        core.info("Posted summary comment (no issues found).");
      } catch (err) {
        core.warning(
          `Failed to post summary comment: ${err instanceof Error ? err.message : String(err)}`
        );
      }

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

    // Post summary comment with the outcome
    const summaryBody = generateSummaryComment(result);
    try {
      await this.githubService.postSummaryComment(summaryBody);
      core.info("Posted summary comment.");
    } catch (err) {
      core.warning(
        `Failed to post summary comment: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return true;
  }
}
