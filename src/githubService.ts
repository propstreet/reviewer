import * as github from "@actions/github";
import { CodeReviewComment } from "./schemas.js";
import { z } from "zod";
import { findPositionInDiff } from "./diffparser.js";

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

export interface ReviewResult {
  skipped: boolean;
  reason?: string;
  commentsPosted?: number;
  commentsFiltered?: number;
}

export interface GitDiffResult {
  commitMessage: string;
  patches: Array<{
    filename: string;
    patch: string;
  }>;
}

export class GitHubService {
  private octokit: ReturnType<typeof github.getOctokit>;
  private config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.octokit = github.getOctokit(config.token);
    this.config = config;
  }

  async postReviewComments(
    comments: z.infer<typeof CodeReviewComment>[],
    severityThreshold: string
  ) {
    // Fetch the PR files to get their patches
    const { data: changedFiles } = await this.octokit.rest.pulls.listFiles({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });

    // Order of severity levels
    const severityOrder = ["info", "warning", "error"];
    const thresholdIndex = severityOrder.indexOf(severityThreshold);

    // Build up the array of comments that meet or exceed the threshold
    const reviewComments = comments
      .filter((c) => severityOrder.indexOf(c.severity) >= thresholdIndex)
      .map((c) => {
        const fileInfo = changedFiles.find((f) => f.filename === c.file);
        if (!fileInfo || !fileInfo.patch) {
          // This file might not exist or doesn't have a patch (binary file, etc.)
          // fallback to top-level or skip
          return {
            path: c.file,
            body: `**File ${c.file} not found or no patch**: ${c.comment}`,
          };
        }

        // Find position in diff
        const pos = this.findPositionInDiff(fileInfo.patch, c.line);
        if (!pos) {
          // We couldn't match that line in the patch
          // fallback to top-level
          return {
            path: c.file,
            body: `**Could not map line ${c.line} in ${c.file}**: ${c.comment}`,
          };
        }

        return {
          path: c.file,
          position: pos,
          body: c.comment,
        };
      });

    // If no comments met the threshold
    if (reviewComments.length === 0) {
      return {
        skipped: true,
        reason: `No comments at or above severity: ${severityThreshold}`,
      };
    }

    // Create a review with multiple comments
    await this.octokit.rest.pulls.createReview({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
      event: "COMMENT",
      comments: reviewComments,
    });

    return {
      skipped: false,
      commentsPosted: reviewComments.length,
      commentsFiltered: comments.length - reviewComments.length,
    };
  }

  private findPositionInDiff(patch: string, targetLine: number): number | null {
    // Import findPositionInDiff from diffparser
    return findPositionInDiff(patch, targetLine);
  }

  async getEntirePRDiff(): Promise<GitDiffResult> {
    const prDetails = await this.octokit.rest.pulls.get({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });
    const prTitle = prDetails.data.title;
    const prBody = prDetails.data.body ?? "";
    const commitMessage = `${prTitle}\n\n${prBody}`.trim();

    const fileList = await this.octokit.rest.pulls.listFiles({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });

    const patches = fileList.data.map((file) => ({
      filename: file.filename,
      patch: file.patch || "",
    }));

    return { commitMessage, patches };
  }

  async getLastCommitDiff(): Promise<GitDiffResult> {
    const commitsResponse = await this.octokit.rest.pulls.listCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });

    const commits = commitsResponse.data;
    if (commits.length === 0) {
      return { commitMessage: "", patches: [] };
    }

    const lastCommit = commits[commits.length - 1];
    const lastCommitSha = lastCommit.sha;
    const parentSha = lastCommit.parents?.[0]?.sha;

    if (!parentSha) {
      // If there's no parent (first commit), return empty result
      return { commitMessage: "", patches: [] };
    }

    const compareData = await this.octokit.rest.repos.compareCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      base: parentSha,
      head: lastCommitSha,
    });

    const commitMessage = lastCommit.commit.message;
    const patches = (compareData.data.files || []).map((file) => ({
      filename: file.filename,
      patch: file.patch || "",
    }));

    return { commitMessage, patches };
  }
}
