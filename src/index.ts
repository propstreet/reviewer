import * as core from "@actions/core";
import * as github from "@actions/github";
import { AzureOpenAI } from "openai";
import { execSync } from "child_process";
import { zodResponseFormat } from "openai/helpers/zod";
import { CodeReviewCommentArray } from "./schemas";

async function run(): Promise<void> {
  try {
    // 1. Grab Inputs
    const azureOpenAIEndpoint = core.getInput("azureOpenAIEndpoint");
    const azureOpenAIDeployment = core.getInput("azureOpenAIDeployment");
    const azureOpenAIKey = core.getInput("azureOpenAIKey");
    const azureOpenAIVersion =
      core.getInput("azureOpenAIVersion") || "2024-12-01-preview";
    const diffMode = core.getInput("diffMode") || "last-commit";

    // 2. Prepare local Git info
    // Ensure 'actions/checkout@v3' with fetch-depth > 1 or 0 has run so HEAD~1 is available.
    let diff = "";
    const commitCount = Number(execSync("git rev-list --count HEAD").toString().trim());

    // (A) Diff
    if (diffMode === "entire-pr") {
      // Compare PR base to HEAD
      const baseRef = process.env.GITHUB_BASE_REF; // branch name
      if (!baseRef) {
        core.info("No GITHUB_BASE_REF found; defaulting to HEAD~1 if possible.");
        if (commitCount > 1) {
          diff = execSync("git diff HEAD~1 HEAD").toString();
        }
      } else {
        diff = execSync(`git diff origin/${baseRef}...HEAD`).toString();
      }
    } else {
      // last-commit mode
      if (commitCount > 1) {
        // If there's more than 1 commit, we can do HEAD~1
        diff = execSync("git diff HEAD~1 HEAD").toString();
      } else {
        // Fallback: Only one commit in the branch—use entire PR diff or skip
        core.info("Only one commit found; falling back to entire PR diff.");
        const baseRef = process.env.GITHUB_BASE_REF;
        if (baseRef) {
          diff = execSync(`git diff origin/${baseRef}...HEAD`).toString();
        }
      }
    }

    // Early exit if no diff
    if (!diff) {
      core.info("No diff found.");
      return;
    }

    core.debug(`Diff: ${diff}`);

    // (B) Last Commit Message
    // Gets the commit message (subject + body) of HEAD
    const commitMessage = execSync("git log -1 --pretty=format:%B HEAD")
      .toString()
      .trim();

    core.info(`Commit Message: ${commitMessage}`);
    core.info(`Diff Length: ${diff.length}`);
    core.info("Calling Azure OpenAI...");

    // 3. Call Azure OpenAI
    const client = new AzureOpenAI({
      endpoint: azureOpenAIEndpoint,
      deployment: azureOpenAIDeployment,
      apiKey: azureOpenAIKey,
      apiVersion: azureOpenAIVersion,
    });

    // We'll add the commit message and diff in a single prompt:
    const completion = await client.beta.chat.completions.parse({
      model: "",
      messages: [
        {
          role: "developer",
          content:
            "You are a helpful code reviewer. Review this diff and provide any suggestions as a JSON array. If you have no comments, return an empty array.",
        },
        {
          role: "user",
          content: `
Commit Message:
${commitMessage}

Diff:
${diff}
`,
        },
      ],
      response_format: zodResponseFormat(
        CodeReviewCommentArray,
        "review_comments"
      ),
    });

    core.debug(`Completion: ${JSON.stringify(completion)}`);

    const finishReason = completion.choices[0].finish_reason;
    if (finishReason !== "stop") {
      core.setFailed(`Review request did not finish, got ${finishReason}`);
      return;
    }

    const response = completion.choices[0].message.parsed;
    if (!response?.comments || response.comments.length === 0) {
      core.info("No suggestions from AI.");
      return;
    }

    // 4. Post Comments to the PR
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      core.setFailed("Missing GITHUB_TOKEN in environment.");
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo, number: pull_number } = github.context.issue;

    // Build up the array of comments
    const reviewComments: Array<{
      path: string;
      line?: number;
      body: string;
    }> = [];

    for (const c of response.comments) {
      core.info(`Commenting on ${c.file}:${c.line}: ${c.comment}`);
      reviewComments.push({
        path: c.file,
        line: c.line,
        body: c.comment,
      });
    }

    // Create a review with multiple comments
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: "COMMENT",
      comments: reviewComments,
    });
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

run();
