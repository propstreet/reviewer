import * as core from "@actions/core";
import * as github from "@actions/github";
import { DiffMode, SeverityLevel } from "./validators.js";
import { isWithinTokenLimit } from "gpt-tokenizer";
import {
  AzureOpenAIService,
  type ReasoningEffort,
  type AzureOpenAIConfig,
} from "./azureOpenAIService.js";
import { CommitDetails, GitHubService, PatchInfo } from "./githubService.js";

function packCommit(
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

export type PackedCommit = {
  commit: CommitDetails;
  patches: PatchInfo[];
};

async function buildPrompt(
  githubService: GitHubService,
  diffMode: DiffMode,
  tokenLimit: number,
  commitLimit: number
) {
  const prDetails = await githubService.getPrDetails(
    diffMode === "entire-pr" ? commitLimit : "last"
  );
  core.debug(
    `Loaded PR #${prDetails.pull_number} with ${prDetails.commits.length} commits.`
  );

  // check that prDetails.headSha is contained in prDetails.commits
  if (!prDetails.commits.find((c) => c.sha === prDetails.headSha)) {
    core.warning(
      `PR head commit ${prDetails.headSha} was not included in PR commits.`
    );
  }

  if (prDetails.commits.length === 0) {
    core.info("No commits found to review.");
    return null;
  }

  core.info(
    `Building prompt for PR #${prDetails.pull_number}: ${prDetails.title}`
  );
  let prompt = `# ${prDetails.title}\n`;

  if (prDetails.body) {
    prompt += `\n${prDetails.body}\n`;
  }

  const packedCommits: PackedCommit[] = [];

  for (const c of prDetails.commits) {
    core.debug(`Processing commit: ${c.sha}`);
    const commitDetails = await githubService.getCommitDetails(c.sha);

    core.debug(
      `Commit ${commitDetails.sha} has ${commitDetails.patches.length} patches. Message: ${commitDetails.message}`
    );
    const packed = packCommit(prompt, commitDetails, tokenLimit);

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
    packedCommits.push({ commit: commitDetails, patches: packed.usedPatches });
  }

  // final token count check
  const tokenCount = isWithinTokenLimit(prompt, tokenLimit);

  core.info(
    `Total Prompt Length: ${prompt.length}, Token Count: ${tokenCount}`
  );

  return {
    prompt,
    commits: packedCommits,
  };
}

export type ReviewOptions = {
  githubToken: string;
  diffMode: DiffMode;
  tokenLimit: number;
  changesThreshold: SeverityLevel;
  reasoningEffort: ReasoningEffort;
  commitLimit: number;
};

export async function review(options: ReviewOptions) {
  const { owner, repo, number: pull_number } = github.context.issue;
  const githubService = new GitHubService({
    token: options.githubToken,
    owner,
    repo,
    pullNumber: pull_number,
  });

  const pr = await buildPrompt(
    githubService,
    options.diffMode,
    options.tokenLimit,
    options.commitLimit
  );
  if (!pr || !pr.commits || pr.commits.length === 0) {
    core.info("No commits found to review.");
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

  const response = await azureService.runReviewPrompt(pr.prompt, {
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
    pr.commits
  );

  core.info(
    `Posted ${result.reviewComments} comments and requested ${result.reviewChanges} changes.`
  );
}
