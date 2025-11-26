import * as core from "@actions/core";
import * as github from "@actions/github";
import { CodeReviewComment } from "./schemas.js";
import { z } from "zod";
import { formatError, SeverityLevel } from "./validators.js";
import {
  findPositionInDiff,
  verifyMultiLineCommentRange,
} from "./diffparser.js";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface ReviewComment {
  path: string;
  position?: number;
  body: string;
}

export type CompareResults = {
  base: string;
  head: string;
  commits: CommitDetails[];
  patches: PatchInfo[];
};

export type PatchInfo = {
  filename: string;
  patch: string;
};

export interface CommitDetails {
  sha: string;
  message: string;
  patches: PatchInfo[];
}

export interface PrDetails {
  number: number;
  title: string;
  body?: string;
  head: string;
  base: string;
  commitCount: number;
}

/**
 * Extracts patches from a list of files, filtering out files without patches.
 */
function extractPatches(
  files: Array<{ filename: string; patch?: string }> | undefined
): PatchInfo[] {
  return (files || [])
    .filter((file) => !!file.patch && file.patch.length > 0)
    .map((file) => ({
      filename: file.filename,
      patch: file.patch!,
    }));
}

export class GitHubService {
  private octokit: ReturnType<typeof github.getOctokit>;
  private config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.octokit = github.getOctokit(config.token);
    this.config = config;
  }

  private verifyCommentLineInPatch(
    filename: string,
    line: number,
    side: "LEFT" | "RIGHT",
    patches: PatchInfo[],
    start_line: number,
    start_side: "LEFT" | "RIGHT"
  ): boolean {
    const target = patches.find((p) => p.filename === filename);
    if (!target) {
      core.warning(`No patch found for file: ${filename}`);
      return false;
    }

    // For single-line comments (start_line === line)
    if (start_line === line && start_side === side) {
      const position = findPositionInDiff(target.patch, line, side);
      core.debug(`Position for ${filename}:${line}:${side} = ${position}`);
      return position !== null;
    }

    // For multi-line comments
    const range = verifyMultiLineCommentRange(
      target.patch,
      start_line,
      line,
      start_side,
      side
    );
    core.debug(
      `Multi-line range for ${filename}:${start_line}:${start_side} to ${line}:${side} = ${
        range ? `${range.startPosition}-${range.endPosition}` : "null"
      }`
    );
    return range !== null;
  }

  private async createReview(
    event: "REQUEST_CHANGES" | "COMMENT",
    review: z.infer<typeof CodeReviewComment>[],
    sha: string
  ) {
    core.debug(
      `Creating ${event} review for ${sha} with ${review.length} comments`
    );
    await this.octokit.rest.pulls.createReview({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
      commit_id: sha,
      event: event,
      comments: review.map((c) => {
        const comment: {
          path: string;
          line: number;
          side: "LEFT" | "RIGHT";
          body: string;
          start_line?: number;
          start_side?: "LEFT" | "RIGHT";
        } = {
          path: c.file,
          line: c.line,
          side: c.side,
          body: c.comment,
        };

        // Only add multi-line fields if it's actually a multi-line comment
        // (start_line !== line means it spans multiple lines)
        if (c.start_line !== c.line || c.start_side !== c.side) {
          comment.start_line = c.start_line;
          comment.start_side = c.start_side;
        }

        return comment;
      }),
    });
  }

  /**
   * P0 Fix: Single PR review model
   * - Collects all valid comments and submits ONE review for the entire PR
   * - Uses HEAD sha to avoid "line must be part of diff" errors
   * - Determines review event based on ANY comment meeting severity threshold
   * - Validates comments against cumulative PR diff (base...HEAD) to match GitHub's validation
   */
  async postReviewComments(
    comments: z.infer<typeof CodeReviewComment>[],
    changesThreshold: SeverityLevel,
    patches: PatchInfo[] // Cumulative PR diff (base...HEAD) for validation
  ) {
    // Get PR details to use HEAD sha for the single review
    const prDetails = await this.getPrDetails();
    const headSha = prDetails.head;

    // Order of severity levels
    const severityOrder = ["info", "warning", "error"];
    const thresholdIndex = severityOrder.indexOf(changesThreshold);

    // Validate and categorize comments
    const validComments: z.infer<typeof CodeReviewComment>[] = [];
    const issueComments: z.infer<typeof CodeReviewComment>[] = [];

    for (const c of comments) {
      // Verify the comment can be placed in the cumulative PR diff
      const isValid = this.verifyCommentLineInPatch(
        c.file,
        c.line,
        c.side,
        patches,
        c.start_line,
        c.start_side
      );

      if (isValid) {
        validComments.push(c);
      } else {
        core.warning(
          `Comment is out of range for ${c.file}:${c.line}:${c.side}: ${c.comment}`
        );
        issueComments.push(c);
      }
    }

    // Separate by severity threshold
    const blockingComments = validComments.filter(
      (c) => severityOrder.indexOf(c.severity) >= thresholdIndex
    );
    const infoComments = validComments.filter(
      (c) => severityOrder.indexOf(c.severity) < thresholdIndex
    );

    // Submit single review if there are valid comments
    if (validComments.length > 0) {
      // Use REQUEST_CHANGES if ANY comment meets threshold, otherwise COMMENT
      const event = blockingComments.length > 0 ? "REQUEST_CHANGES" : "COMMENT";
      core.info(
        `Submitting ${event} review with ${validComments.length} comments (${blockingComments.length} blocking, ${infoComments.length} info)`
      );
      await this.createReview(event, validComments, headSha);
    }

    // Post fallback comments as issue comments (for out-of-range comments)
    for (const comment of issueComments) {
      await this.octokit.rest.issues.createComment({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: this.config.pullNumber,
        body: `**${comment.severity.toUpperCase()}** - ${comment.file}:${comment.line}\n\n${comment.comment}`,
      });
    }

    return {
      reviewChanges: blockingComments.length,
      reviewComments: infoComments.length,
      issueComments: issueComments.length,
    };
  }

  async getPrDetails(): Promise<PrDetails> {
    const prResponse = await this.octokit.rest.pulls.get({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });

    if (prResponse.status !== 200) {
      throw new Error(
        `Failed to list commits for pr #${this.config.pullNumber}, status: ${prResponse.status}`
      );
    }

    return {
      number: prResponse.data.number,
      title: prResponse.data.title,
      body: prResponse.data.body ? prResponse.data.body : undefined,
      head: prResponse.data.head.sha,
      base: prResponse.data.base.sha,
      commitCount: prResponse.data.commits,
    };
  }

  async compareCommits(base: string, head: string): Promise<CompareResults> {
    try {
      const response = await this.octokit.rest.repos.compareCommitsWithBasehead(
        {
          owner: this.config.owner,
          repo: this.config.repo,
          basehead: `${base}...${head}`,
        }
      );

      if (response.status !== 200) {
        throw new Error(
          `Failed to compare commit head ${head} to base ${base}, status: ${response.status}`
        );
      }

      return {
        base,
        head,
        commits: response.data.commits.map((commit) => ({
          sha: commit.sha,
          message: commit.commit.message,
          patches: [], // get patches for each commit to base
        })),
        patches: extractPatches(response.data.files),
      };
    } catch (error) {
      throw new Error(`Failed to compare commits: ${formatError(error)}`);
    }
  }

  async getCommitDetails(sha: string): Promise<CommitDetails> {
    try {
      const response = await this.octokit.rest.repos.getCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: sha,
      });

      if (response.status !== 200) {
        throw new Error(
          `Failed to get commit details for ${sha}, status: ${response.status}`
        );
      }

      return {
        sha,
        message: response.data.commit.message,
        patches: extractPatches(response.data.files),
      };
    } catch (error) {
      throw new Error(`Failed to get commit details: ${formatError(error)}`);
    }
  }

  async commitBelongsToPR(sha: string): Promise<boolean> {
    try {
      const response =
        await this.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: this.config.owner,
          repo: this.config.repo,
          commit_sha: sha,
        });

      return response.data.some((pr) => pr.number === this.config.pullNumber);
    } catch (error) {
      throw new Error(
        `Failed to list PRs associated with commit ${sha}: ${formatError(error)}`
      );
    }
  }
}
