import * as core from "@actions/core";
import * as github from "@actions/github";
import { CodeReviewComment } from "./schemas.js";
import { z } from "zod";
import { SeverityLevel } from "./validators.js";
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

export type PatchInfo = {
  filename: string;
  patch: string;
};

export interface GitDiffResult {
  commitSha?: string;
  commitMessage: string;
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
    patches: PatchInfo[]
  ): boolean {
    const target = patches.find((p) => p.filename === filename);
    if (!target) {
      core.warning(`No patch found for file: ${filename}`);
      return false;
    }
    const position = findPositionInDiff(target.patch, line);
    core.debug(`Position for ${filename}:${line} = ${position}`);
    return position !== null;
  }

  private async createReview(
    event: "REQUEST_CHANGES" | "COMMENT",
    review: z.infer<typeof CodeReviewComment>[],
    commit_id?: string
  ) {
    await this.octokit.rest.pulls.createReview({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
      commit_id: commit_id,
      event: event,
      comments: review.map((c) => ({
        path: c.file,
        line: c.line,
        body: c.comment,
      })),
    });
  }

  async postReviewComments(
    comments: z.infer<typeof CodeReviewComment>[],
    changesThreshold: SeverityLevel,
    commitSha?: string,
    patches?: PatchInfo[]
  ) {
    // Order of severity levels
    const severityOrder = ["info", "warning", "error"];
    const thresholdIndex = severityOrder.indexOf(changesThreshold);

    // Separate comments that are outside the diff patch
    const issueComments: z.infer<typeof CodeReviewComment>[] = [];
    const validComments = comments.filter((c) => {
      if (!patches || !this.verifyCommentLineInPatch(c.file, c.line, patches)) {
        issueComments.push(c);
        return false;
      }
      return true;
    });

    // Build up the array of comments that meet or exceed the threshold to require changes
    const reviewChanges = validComments.filter(
      (c) => severityOrder.indexOf(c.severity) >= thresholdIndex
    );

    if (reviewChanges.length) {
      await this.createReview("REQUEST_CHANGES", reviewChanges, commitSha);
    }

    // The remaining comments will be posted as informational comments
    const reviewComments = validComments.filter(
      (c) => !reviewChanges.includes(c)
    );

    if (reviewComments.length) {
      await this.createReview("COMMENT", reviewComments, commitSha);
    }

    // Post fallback comments as issue comments
    for (const comment of issueComments) {
      await this.octokit.rest.issues.createComment({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: this.config.pullNumber,
        body: `Comment on line ${comment.line} of file ${comment.file}: ${comment.comment}`,
      });
    }

    return {
      reviewChanges: reviewChanges.length,
      reviewComments: reviewComments.length,
      issueComments: issueComments.length,
    };
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

  async getLastCommitDiff(): Promise<GitDiffResult | null> {
    const commitsResponse = await this.octokit.rest.pulls.listCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: this.config.pullNumber,
    });

    const commits = commitsResponse.data;
    if (commits.length === 0) {
      return null;
    }

    const lastCommit = commits[commits.length - 1];
    const lastCommitSha = lastCommit.sha;
    const parentSha = lastCommit.parents?.[0]?.sha;
    const commitMessage = lastCommit.commit.message;

    if (!parentSha) {
      // If there's no parent (first commit), use entire PR diff
      const prDiff = await this.getEntirePRDiff();
      return {
        commitSha: lastCommitSha,
        commitMessage,
        patches: prDiff.patches,
      };
    }

    const compareData = await this.octokit.rest.repos.compareCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      base: parentSha,
      head: lastCommitSha,
    });

    const patches = (compareData.data.files || []).map((file) => ({
      filename: file.filename,
      patch: file.patch || "",
    }));

    return { commitSha: lastCommitSha, commitMessage, patches };
  }
}
