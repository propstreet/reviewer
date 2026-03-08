# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Action that uses Azure OpenAI to automatically review pull request diffs and post inline code review comments. It uses structured output (Zod schemas) to ensure the AI returns valid, parseable review comments.

## Commands

```bash
npm install              # Install dependencies
npm test                 # Run tests (Vitest, watch mode)
npm test -- --run        # Run tests once without watch
npm test -- src/diffparser.test.ts  # Run single test file
npm run coverage         # Run tests with coverage
npm run build            # Build TypeScript (type checking)
npm run lint             # Lint code
npm run lint:fix         # Lint and auto-fix
npm run format           # Format code with Prettier
npm run package          # Package for distribution (creates dist/index.js via ncc)

# Prompt testing with promptfoo
npm run test-prompts     # Evaluate prompts against test cases
npm run view-prompts     # View prompt evaluation results in browser
```

## Architecture

### Data Flow

1. **index.ts** - Entry point. Validates GitHub Action inputs, initializes services, triggers review
2. **reviewer.ts** - Orchestrator. Builds prompt from PR commits, calls AI, posts results
3. **githubService.ts** - GitHub API interactions. Fetches PR details, commits, diffs; posts review comments
4. **azureOpenAIService.ts** - Azure OpenAI client. Sends prompts, handles structured output parsing, supports background polling for long-running requests
5. **diffparser.ts** - Unified diff parser. Validates comment line positions, detects hunk boundaries for multi-line comments

### Key Concepts

**Comment Validation Flow**: AI returns comments with file/line info → `githubService.verifyCommentLineInPatch()` validates against cumulative PR diff → valid comments become review thread comments, invalid ones fall back to issue comments

**Multi-line Comment Hunk Detection**: GitHub API requires `start_line` and `line` to be in the same diff hunk. `diffparser.parseDiff()` tracks hunk indices; `verifyMultiLineCommentRange()` rejects cross-hunk ranges.

**Token Management**: `reviewer.packCommit()` uses `gpt-tokenizer` to fit as many patches as possible within the token limit, skipping files that would exceed it.

**Background Mode**: For slow models (15+ min), `azureOpenAIService` uses OpenAI's `background: true` parameter with exponential backoff polling. Has two layers of retry logic:
- **HTTP-level retries** (`createBackgroundRequestWithRetry`): Retries `responses.create()` on transient HTTP errors (408/429/500/502/503/504) with exponential backoff (5s initial, max 20s, 3 retries).
- **Application-level retries** (`runBackgroundRequest`): When a background request reaches `failed` terminal status with a transient error (`server_error`, `rate_limit_exceeded`, or Azure's generic error message), retries the entire background request flow (new create → poll → handle) with exponential backoff (5s initial, max 20s, 3 retries).
- **`isRetryableBackgroundFailure()`** checks `response.error.code` and `response.error.message` to distinguish transient failures from permanent ones (e.g., `invalid_prompt`).
- **`logBackgroundFailureDetails()`** logs response ID, full error object, elapsed time, polling attempts, and token usage for diagnostics.

## Development Workflow

**Feature branches** - For new features and bug fixes:
```bash
git checkout main && git pull
git checkout -b feat/my-feature    # or fix/my-bug
# ... make changes ...
git add -A && git commit -m "feat: add new feature"
git push -u origin feat/my-feature
gh pr create --title "feat: add new feature" --body "..."
```

## Release Process

Release prep is done on the feature branch before merging, so main is always release-ready.

1. Before merging your feature PR, prepare the release:
   ```bash
   npm version patch|minor|major --no-git-tag-version
   # Update CHANGELOG.md (Keep a Changelog format)
   npm run lint && npm run build && npm test
   npm run package
   git add -A && git commit -m "chore(release): vX.Y.Z"
   git push
   ```
2. Merge PR to main (with branch protection)
3. Tag and release from main:
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
   ```
4. Update floating major tag: `git tag -fa v3 -m "Update v3 tag" && git push origin v3 --force`

## Code Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`
- Tests co-located with source files (`*.test.ts`)
- Keep `dist/index.js` updated via `npm run package` before releases
