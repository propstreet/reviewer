# promptfoo

Use `promptfoo` for testing AI review prompts with different reasoning effort levels.

## Setup

1. Copy the example environment file:
   ```bash
   cp promptfoo/.env.example promptfoo/.env
   ```

2. Fill in your Azure OpenAI credentials in `promptfoo/.env`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_HOST` | Azure OpenAI endpoint (e.g., `my-resource.openai.azure.com`) |
| `AZURE_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_REASONING_DEPLOYMENT` | Deployment name for reasoning model (e.g., `gpt-5`) |

## Running Tests

```bash
# Run prompt evaluation
npm run test-prompts

# View results in browser
npm run view-prompts
```

## Configuration

The `promptfooconfig.yaml` tests three reasoning effort levels:
- **low** - Fast reviews, good for simple PRs
- **medium** - Balanced quality and speed
- **high** - Thorough reviews for complex PRs

All providers use the Azure OpenAI Responses API with `api-version=preview`.
