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
    const azureOpenAIVersion = core.getInput("azureOpenAIVersion") || "2024-12-01-preview";
    const diffMode = core.getInput("diffMode") || "last-commit";

    // 2. Git Diff
    // Make sure 'actions/checkout@v3' has run before this so there's a local .git, ensure to fetch all history using fetch-depth: 0
    let diff = "";
    if (diffMode === "entire-pr") {
      // For entire PR, you'd compare the base commit to head
      // but we rely on GitHub env variables:
      // GITHUB_BASE_REF / GITHUB_HEAD_REF are branch names, not SHAs.
      // GITHUB_SHA is the commit ref for the event.
      // The approach can vary. We'll do a naive example:
      // (In many real setups, you'd parse environment variables or use the GitHub API.)
      diff = execSync(
        `git diff origin/${process.env.GITHUB_BASE_REF}...HEAD`
      ).toString();
    } else {
      // Default to just last commit
      diff = execSync("git diff HEAD~1 HEAD").toString();
    }

    if (!diff) {
      core.info("No diff found.");
      return;
    }

    // 3. Call Azure OpenAI
    const client = new AzureOpenAI({
      endpoint: azureOpenAIEndpoint,
      deployment: azureOpenAIDeployment,
      apiKey: azureOpenAIKey,
      apiVersion: azureOpenAIVersion,
    });

    // Build your prompt. For GPT-4 style models:
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
          content: diff,
        },
      ],
      response_format: zodResponseFormat(
        CodeReviewCommentArray,
        "review_comments"
      ),
    });

    const aiComments = completion.choices[0].message.parsed;
    if (!aiComments || aiComments.length === 0) {
      core.info("No suggestions from AI.");
      return;
    }

    // 4. Post Comments to the PR
    //   We’ll create a single "review" with multiple comments.
    //   If file/line are missing, we do a top-level comment.
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

    for (const c of aiComments) {
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
  } catch (err: any) {
    core.setFailed(err.message);
  }
}

run();
