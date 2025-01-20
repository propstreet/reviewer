# AI Pull Request Reviewer

This GitHub Action uses Azure OpenAI to automatically review pull request diffs and post comments.  

## How It Works

1. **Generates a Git diff** (either for the entire PR or just the last commit).
2. **Sends the diff and the last commit message** to Azure OpenAI, asking for a structured JSON response.
3. **Posts AI-generated review comments** on your pull request.

## Usage

1. **Create a workflow file** (e.g. `.github/workflows/ai-review.yml` in your target repo):

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize] # triggers on new PR and each commit

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:

      - name: Run AI Reviewer
        uses: propstreet/reviewer@v2
        with:
          azureOpenAIEndpoint: ${{ secrets.AZURE_OPENAI_REASONING_ENDPOINT }}
          azureOpenAIDeployment: ${{ secrets.AZURE_OPENAI_REASONING_DEPLOYMENT }}
          azureOpenAIKey: ${{ secrets.AZURE_OPENAI_API_KEY }}
          azureOpenAIVersion: ${{ secrets.AZURE_OPENAI_REASONING_VERSION }}
          diffMode: "last-commit" # or entire-pr
          severity: "info" # or "warning" or "error"
          reasoningEffort: "medium" # or "low" or "high"
        env:
          # Make sure GITHUB_TOKEN has write permissions to create reviews
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

```

2. **Secrets**

- AZURE_OPENAI_REASONING_ENDPOINT should be your Azure OpenAI endpoint URL to a reasoning model. (e.g. <https://my-o1-resource.openai.azure.com/openai/deployments/...>)
- AZURE_OPENAI_REASONING_DEPLOYMENT is your Azure OpenAI deployment name for the reasoning model. (e.g. my-o1-deployment)
- AZURE_OPENAI_REASONING_VERSION is the version of the Azure OpenAI API used for calling the reasoning model. (e.g. 2024-12-01-preview)
- AZURE_OPENAI_API_KEY is your Azure OpenAI API key.
- The GITHUB_TOKEN is automatically available, but ensure your workflow permission is set to “Read and write” so it can post PR reviews.

3. **Diff Modes**

- diffMode: entire-pr → uses git diff origin/\<base>...HEAD.
- diffMode: last-commit → uses git diff HEAD~1 HEAD (fallback to entire PR if there’s only one commit).

## Development & Contributing

1. Clone this repo.
2. Run npm install.
3. Update code in src/.
4. Run npm run build to compile TypeScript.
5. (Optional) npm run package if you want to bundle with ncc.
6. Push changes, tag a release, and reference it with @v1 or similar in your client repos.
