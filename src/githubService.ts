import * as core from "@actions/core";
import * as github from "@actions/github";
import { CodeReviewComment } from "./schemas.js";
import { z } from "zod";
import { SeverityLevel } from "./validators.js";
import { findPositionInDiff } from "./diffparser.js";
import { type PackedCommit } from "./reviewer.js";

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

export type PatchInfo = {
  filename: string;
  patch: string;
};

export interface CommitDetails {
  sha: string;
  message: string;
  patches: PatchInfo[];
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
    patches: PatchInfo[]
  ): boolean {
    const target = patches.find((p) => p.filename === filename);
    if (!target) {
      core.warning(`No patch found for file: ${filename}`);
      return false;
    }
    const position = findPositionInDiff(target.patch, line, side);
    core.debug(`Position for ${filename}:${line}:${side} = ${position}`);
    return position !== null;
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
      comments: review.map((c) => ({
        path: c.file,
        line: c.line,
        side: c.side,
        body: c.comment,
      })),
    });
  }

  async postReviewComments(
    comments: z.infer<typeof CodeReviewComment>[],
    changesThreshold: SeverityLevel,
    commits: PackedCommit[]
  ) {
    // Order of severity levels
    const severityOrder = ["info", "warning", "error"];
    const thresholdIndex = severityOrder.indexOf(changesThreshold);

    // Separate comments that are outside the diff patch
    const issueComments: z.infer<typeof CodeReviewComment>[] = [];

    // group comments by commit
    const commentsByCommit = comments.reduce(
      (acc, c) => {
        const commit = commits.find((d) => d.commit.sha === c.sha);
        if (!commit) {
          core.warning(`No commit found for sha: ${c.sha}`);
          issueComments.push(c);
          return acc;
        }

        if (
          !this.verifyCommentLineInPatch(c.file, c.line, c.side, commit.patches)
        ) {
          core.warning(
            `Comment is out of range for ${c.file}:${c.line}:${c.side}: ${c.comment}`
          );
          issueComments.push(c);
          return acc;
        }

        const group = acc.find((g) => g.sha === c.sha);
        if (group) {
          group.comments.push(c);
        } else {
          acc.push({
            sha: c.sha,
            commit,
            comments: [c],
          });
        }

        return acc;
      },
      [] as {
        sha: string;
        commit: PackedCommit;
        comments: z.infer<typeof CodeReviewComment>[];
      }[]
    );

    const allChanges: z.infer<typeof CodeReviewComment>[] = [];
    const allComments: z.infer<typeof CodeReviewComment>[] = [];

    // process each sha separately
    for (const group of commentsByCommit) {
      // Build up the array of comments that meet or exceed the threshold to require changes
      const groupChanges = group.comments.filter(
        (c) => severityOrder.indexOf(c.severity) >= thresholdIndex
      );

      if (groupChanges.length) {
        await this.createReview("REQUEST_CHANGES", groupChanges, group.sha);

        allChanges.push(...groupChanges);
      }

      // The remaining comments will be posted as informational comments
      const groupComments = group.comments.filter(
        (c) => !groupChanges.includes(c)
      );

      if (groupComments.length) {
        await this.createReview("COMMENT", groupComments, group.sha);

        allComments.push(...groupComments);
      }
    }

    // Post fallback comments as issue comments
    for (const comment of issueComments) {
      await this.octokit.rest.issues.createComment({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: this.config.pullNumber,
        body: `Comment on line ${comment.line} (${comment.side}) of file ${comment.file}: ${comment.comment}`,
      });
    }

    return {
      reviewChanges: allChanges.length,
      reviewComments: allComments.length,
      issueComments: issueComments.length,
    };
  }

  async getPrDetails() {
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

    const commitsResponse = await this.octokit.rest.pulls.listCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });

    if (commitsResponse.status !== 200) {
      throw new Error(
        `Failed to list commits for pr #${this.config.pullNumber}, status: ${commitsResponse.status}`
      );
    }

    return {
      pull_number: prResponse.data.number,
      title: prResponse.data.title,
      body: prResponse.data.body,
      commits: commitsResponse.data.map((c) => ({ sha: c.sha })),
    };
  }

  async compareCommits(baseSha: string, headSha: string): Promise<PatchInfo[]> {
    try {
      const response = await this.octokit.rest.repos.compareCommitsWithBasehead(
        {
          owner: this.config.owner,
          repo: this.config.repo,
          basehead: `${baseSha}...${headSha}`,
        }
      );

      if (response.status !== 200) {
        throw new Error(
          `Failed to compare commit head ${headSha} to base ${baseSha}, status: ${response.status}`
        );
      }

      const patches = (response.data.files || [])
        .filter((file) => !!file.patch && file.patch.length > 0)
        .map((file) => ({
          filename: file.filename,
          patch: file.patch!,
        }));

      return patches;
    } catch (error) {
      throw new Error(
        `Failed to compare commits: ${error instanceof Error ? error.message : String(error)}`
      );
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

      const patches = (response.data.files || [])
        .filter((file) => !!file.patch && file.patch.length > 0)
        .map((file) => ({
          filename: file.filename,
          patch: file.patch!,
        }));

      return {
        sha,
        message: response.data.commit.message,
        patches,
      };
    } catch (error) {
      throw new Error(
        `Failed to get commit details: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
