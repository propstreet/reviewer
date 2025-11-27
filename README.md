# AI Pull Request Reviewer

A GitHub Action that uses Azure OpenAI to automatically review pull request diffs and post inline code review comments.

## Features

- **Azure OpenAI Responses API** - Uses the latest v1 API with structured output
- **Reasoning models support** - Works with GPT-5-Codex, GPT-5, o4-mini, o3, and other reasoning models
- **Background mode** - Handles long-running requests (15+ minutes) with automatic polling
- **Multi-line comments** - Can highlight ranges of code, not just single lines
- **Custom instructions** - Append your own guidelines to the review prompt
- **Severity filtering** - Control when to request changes vs post comments
- **File exclusions** - Skip generated files, tests, or any glob pattern
- **Token management** - Automatic truncation to stay within model limits

## How It Works

1. **Generates a Git diff** between the base and head commits
2. **Sends the diff** to Azure OpenAI with structured output schema
3. **Posts AI-generated review comments** on your pull request

## Quick Start

Create a workflow file at `.github/workflows/ai-review.yml`:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - name: Run AI Reviewer
        uses: propstreet/reviewer@v3
        with:
          azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
          azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Configuration

### Required Inputs

| Input | Description |
|-------|-------------|
| `azureOpenAIKey` | Your Azure OpenAI API key |
| `azureOpenAIEndpoint` | Azure OpenAI endpoint URL (e.g., `https://my-resource.openai.azure.com`) |
| `azureOpenAIDeployment` | Deployment name for your model |

### Optional Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `severity` | `error` | Minimum severity to request changes (`info`, `warning`, `error`) |
| `reasoningEffort` | `medium` | Reasoning effort level (`minimal`, `low`, `medium`, `high`) |
| `tokenLimit` | `50000` | Maximum tokens to send (o1 supports up to 200,000) |
| `commitLimit` | `100` | Maximum commits to include in diff |
| `exclude` | | Comma-separated glob patterns to exclude files |
| `customPrompt` | | Custom instructions appended to system prompt (max 1000 chars) |
| `base` | | Base commit SHA (auto-detected from PR event) |
| `head` | | Head commit SHA (auto-detected from PR event) |
| `backgroundMode` | `disabled` | Enable background mode for long-running requests (`enabled`, `disabled`) |
| `backgroundMaxWait` | `30` | Maximum wait time in minutes for background requests (1-60) |
| `backgroundPollInterval` | `10` | Initial polling interval in seconds for background requests (5-60) |

## Examples

### With Custom Instructions

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
    customPrompt: "Focus on security vulnerabilities and performance issues. Ignore style suggestions."
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### With File Exclusions

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
    exclude: "*.test.ts, dist/**/*.*, *.lock"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Recommended Setup (gpt-5.1 with high reasoning)

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
    reasoningEffort: high
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Fast Reviews (minimal reasoning)

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
    reasoningEffort: minimal
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Background Mode (for gpt-5-pro)

When using gpt-5-pro, reviews typically take 15-20 minutes. Background mode handles this
with automatic polling:

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: gpt-5-pro
    reasoningEffort: high
    backgroundMode: enabled
    backgroundMaxWait: "30" # minutes (1-60)
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Background mode features:
- Uses `background: true` parameter in the Responses API
- Automatic exponential backoff polling (1.5x multiplier, max 30s intervals)
- Automatic request cancellation on timeout
- Detailed progress logging in GitHub Actions

## Azure OpenAI Setup

### Requirements

- Azure OpenAI resource with a deployed reasoning model
- The deployment must support the **Responses API** (v1 endpoint)

### Endpoint Format

The action uses the Azure OpenAI v1 API:
```
{endpoint}/openai/v1/responses
```

### Recommended Models

The `reasoningEffort` input controls how much reasoning the model applies:

| Model | `reasoningEffort` | Use Case |
|-------|-------------------|----------|
| **gpt-5.1** | `high` | **Recommended default** - Best quality reviews |
| gpt-5 | `high` | Excellent reviews, slightly older model |
| gpt-5.1 | `medium` | Faster reviews, good quality |
| gpt-5 | `minimal` | Quick reviews, lower latency |
| gpt-5-pro | `high` | Most thorough reviews (15-20 min, requires `backgroundMode: enabled`) |

We recommend **gpt-5.1 with `reasoningEffort: high`** for the best balance of quality and speed.

## Severity Levels

Comments are posted based on severity:

- **`info`** - Suggestions, style recommendations
- **`warning`** - Potential issues, code smells
- **`error`** - Bugs, security vulnerabilities, breaking changes

The `severity` input controls the threshold for "Request Changes" reviews:
- `severity: error` (default) - Only errors trigger "Request Changes"
- `severity: warning` - Warnings and errors trigger "Request Changes"
- `severity: info` - All comments trigger "Request Changes"

## Multi-line Comments

The reviewer can create multi-line comments that highlight ranges of code. This is useful for:
- Highlighting a function that needs refactoring
- Pointing out a block of duplicated code
- Suggesting changes that span multiple lines

The AI automatically decides when to use single-line vs multi-line comments based on context.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run coverage

# Lint and format
npm run lint:fix

# Build TypeScript
npm run build

# Package for distribution
npm run package
```

### Testing Prompts

The project includes promptfoo configuration for testing different prompts:

```bash
# Run prompt evaluation
npm run test-prompts

# View results
npm run view-prompts
```

### Release Process

To create a new release:

1. **Update version** in `package.json`
   ```bash
   # For minor release (new features, backwards compatible)
   npm version minor --no-git-tag-version

   # For patch release (bug fixes only)
   npm version patch --no-git-tag-version
   ```

2. **Update CHANGELOG.md** - Add entry following [Keep a Changelog](https://keepachangelog.com/) format:
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added
   - New features

   ### Changed
   - Changes to existing functionality

   ### Fixed
   - Bug fixes
   ```

3. **Run all checks**
   ```bash
   npm test && npm run build && npm run lint
   ```

4. **Rebuild distribution**
   ```bash
   npm run package
   ```

5. **Commit, push, and create PR**
   ```bash
   git add -A
   git commit -m "chore: release vX.Y.Z"
   git push origin your-branch
   gh pr create --title "chore: release vX.Y.Z"
   ```

6. **After PR is merged**, create tag and release:
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z - Brief description"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "See CHANGELOG.md for details"
   ```

7. **Update floating major tag** (e.g., `v3` → `v3.3.0`):
   ```bash
   git tag -fa v3 -m "Update v3 tag to vX.Y.Z"
   git push origin v3 --force
   ```
   This allows users with `@v3` in their workflows to automatically get the latest release.

## Migration from v2

See [CHANGELOG.md](./CHANGELOG.md) for detailed migration instructions.

Key changes:
1. Update workflow to use `@v3`
2. Azure deployment must support the Responses API
3. Optional: Add `customPrompt` for custom instructions

## License

MIT
