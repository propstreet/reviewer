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

### High Reasoning Effort (for complex PRs)

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
    reasoningEffort: high
    tokenLimit: "100000"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Minimal Reasoning (GPT-5, for fast reviews)

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: gpt-5
    reasoningEffort: minimal
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Background Mode (for long-running reviews)

When using high reasoning effort models like GPT-5-Pro, reviews can take 15+ minutes.
Background mode uses the OpenAI Responses API's async capabilities with automatic polling:

```yaml
- uses: propstreet/reviewer@v3
  with:
    azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
    azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azureOpenAIDeployment: gpt-5-pro
    reasoningEffort: high
    backgroundMode: enabled
    backgroundMaxWait: "45"        # Wait up to 45 minutes
    backgroundPollInterval: "15"   # Start polling every 15 seconds
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

#### Best for Code Review

| Model | Use Case | Notes |
|-------|----------|-------|
| **gpt-5-codex** | Code review, refactoring | Trained specifically for code reviews |
| **gpt-5.1-codex** | Latest code review model | 30% fewer tokens than gpt-5-codex |
| **o4-mini** | Cost-effective reasoning | Best value for reasoning tasks |

#### General Purpose

| Model | Use Case | Notes |
|-------|----------|-------|
| gpt-5 | Multi-step reasoning | $1.25/$10 per 1M tokens |
| gpt-5-mini | Cost-sensitive | $0.25/$2 per 1M tokens |
| gpt-5-nano | Fast reviews, low latency | $0.05/$0.40 per 1M tokens |
| o3 | Complex architectural review | 200K context, premium |
| o3-mini | Fast reasoning | Budget-friendly |
| o1 | Legacy reasoning | Still supported |

#### Model Selection Guide

- **For thorough code reviews**: Use `gpt-5-codex` or `gpt-5.1-codex` with `high` reasoning effort
- **For fast iteration**: Use `gpt-5-nano` with `minimal` reasoning effort
- **For balanced cost/quality**: Use `o4-mini` with `medium` reasoning effort

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

## Migration from v2

See [CHANGELOG.md](./CHANGELOG.md) for detailed migration instructions.

Key changes:
1. Update workflow to use `@v3`
2. Azure deployment must support the Responses API
3. Optional: Add `customPrompt` for custom instructions

## License

MIT
