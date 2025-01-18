"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const openai_1 = require("openai");
const child_process_1 = require("child_process");
const zod_1 = require("openai/helpers/zod");
const schemas_1 = require("./schemas");
async function run() {
    try {
        // 1. Grab Inputs
        const azureOpenAIEndpoint = core.getInput("azureOpenAIEndpoint");
        const azureOpenAIDeployment = core.getInput("azureOpenAIDeployment");
        const azureOpenAIKey = core.getInput("azureOpenAIKey");
        const azureOpenAIVersion = core.getInput("azureOpenAIVersion") || "2024-12-01-preview";
        const diffMode = core.getInput("diffMode") || "last-commit";
        // 2. Prepare local Git info
        // Ensure 'actions/checkout@v3' with fetch-depth > 1 or 0 has run so HEAD~1 is available.
        let diff = "";
        const commitCount = Number((0, child_process_1.execSync)("git rev-list --count HEAD").toString().trim());
        // (A) Diff
        if (diffMode === "entire-pr") {
            // Compare PR base to HEAD
            const baseRef = process.env.GITHUB_BASE_REF; // branch name
            if (!baseRef) {
                core.info("No GITHUB_BASE_REF found; defaulting to HEAD~1 if possible.");
                if (commitCount > 1) {
                    diff = (0, child_process_1.execSync)("git diff HEAD~1 HEAD").toString();
                }
            }
            else {
                diff = (0, child_process_1.execSync)(`git diff origin/${baseRef}...HEAD`).toString();
            }
        }
        else {
            // last-commit mode
            if (commitCount > 1) {
                // If there's more than 1 commit, we can do HEAD~1
                diff = (0, child_process_1.execSync)("git diff HEAD~1 HEAD").toString();
            }
            else {
                // Fallback: Only one commit in the branch—use entire PR diff or skip
                core.info("Only one commit found; falling back to entire PR diff.");
                const baseRef = process.env.GITHUB_BASE_REF;
                if (baseRef) {
                    diff = (0, child_process_1.execSync)(`git diff origin/${baseRef}...HEAD`).toString();
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
        const commitMessage = (0, child_process_1.execSync)("git log -1 --pretty=format:%B HEAD")
            .toString()
            .trim();
        core.info(`Commit Message: ${commitMessage}`);
        core.info(`Diff Length: ${diff.length}`);
        core.info("Calling Azure OpenAI...");
        // 3. Call Azure OpenAI
        const client = new openai_1.AzureOpenAI({
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
                    content: "You are a helpful code reviewer. Review this diff and provide any suggestions as a JSON array. If you have no comments, return an empty array.",
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
            response_format: (0, zod_1.zodResponseFormat)(schemas_1.CodeReviewCommentArray, "review_comments"),
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
        const reviewComments = [];
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
    }
    catch (err) {
        core.setFailed(err.message);
    }
}
run();
//# sourceMappingURL=index.js.map