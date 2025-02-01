import * as core from "@actions/core";
import { SeverityLevel } from "./validators.js";
import { isWithinTokenLimit } from "gpt-tokenizer/encoding/o200k_base";
import {
  AzureOpenAIService,
  type ReasoningEffort,
} from "./azureOpenAIService.js";
import { CommitDetails, GitHubService, PatchInfo } from "./githubService.js";

export type ReviewOptions = {
  base: string;
  head: string;
  tokenLimit: number;
  changesThreshold: SeverityLevel;
  reasoningEffort: ReasoningEffort;
  commitLimit: number;
};

export type PackedCommit = {
  commit: CommitDetails;
  patches: PatchInfo[];
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
    tokenLimit: number
  ) {
    core.debug(`Packing commit: ${commit.sha}`);

    let commitBlock = `\n## COMMIT SHA: ${commit.sha}\n\n${commit.message}\n`;
    const skippedPatches: PatchInfo[] = [];
    const usedPatches: PatchInfo[] = [];

    for (const p of commit.patches) {
      core.debug(`Packing patch: ${p.filename}`);

      const patchBlock = `\n### FILE: ${p.filename}\n\n\`\`\`diff\n${p.patch}\n\`\`\`\n`;
      // Check if we can add this patch without exceeding limit
      const combinedPreview = accumulated + commitBlock + patchBlock;
      // isWithinTokenLimit returns false if limit exceeded
      const check = isWithinTokenLimit(combinedPreview, tokenLimit);
      if (!check) {
        // Skip adding this patch
        core.debug(`Skipping patch ${p.filename} due to token limit.`);
        skippedPatches.push(p);
        continue;
      }
      // If within limit, add it
      core.debug(`Adding patch ${p.filename} to commit block.`);
      commitBlock += patchBlock;
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

    // check that prDetails.head is contained in patches.commits
    if (!results.commits.find((c) => c.sha === prDetails.head)) {
      core.warning(
        `PR head commit ${prDetails.head} was not included in commit comparison.`
      );
    }

    if (results.commits.length === 0) {
      core.info("No commits found to review.");
      return null;
    }

    core.info(
      `Building prompt for PR #${prDetails.number}: ${prDetails.title}`
    );
    let prompt = `# ${prDetails.title}\n`;

    if (prDetails.body) {
      prompt += `\n${prDetails.body}\n`;
    }

    const packedCommits: PackedCommit[] = [];

    for (const c of results.commits) {
      core.debug(`Processing commit: ${c.sha}`);
      const commitDetails = await this.githubService.getCommitDetails(c.sha);

      core.debug(
        `Commit ${commitDetails.sha} has ${commitDetails.patches.length} patches. Message: ${commitDetails.message}`
      );
      const packed = this.packCommit(prompt, commitDetails, options.tokenLimit);

      if (!packed) {
        core.warning(`Could not pack commit ${c.sha} within token limit.`);
        break;
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

    // final token count check
    const tokenCount = isWithinTokenLimit(prompt, options.tokenLimit);

    core.info(
      `Total Prompt Length: ${prompt.length}, Token Count: ${tokenCount}`
    );

    return {
      prompt,
      commits: packedCommits,
    };
  }

  async review(options: ReviewOptions) {
    const pr = await this.buildPrompt(options);
    if (!pr || !pr.commits || pr.commits.length === 0) {
      core.info("No commits found to review.");
      return;
    }

    core.info("Calling Azure OpenAI...");

    const response = await this.azureService.runReviewPrompt(pr.prompt, {
      reasoningEffort: options.reasoningEffort,
    });

    if (!response?.comments || response.comments.length === 0) {
      core.info("No suggestions from AI.");
      return;
    }

    core.info(`Got ${response.comments.length} suggestions from AI.`);

    // 4. Post Comments to PR
    const result = await this.githubService.postReviewComments(
      response.comments,
      options.changesThreshold,
      pr.commits
    );

    core.info(
      `Posted ${result.reviewComments} comments and requested ${result.reviewChanges} changes.`
    );
  }
}
