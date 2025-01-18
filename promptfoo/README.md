# promptfoo

Use `promptfoo` for running tests on our LLM prompts.

## Usage

To run `promptfoo`, use the following command:

```bash
npm run test-prompts
```

## Configuration

Set the following environment variables before running the tests:

- `AZURE_API_HOST` : The host URL for the Azure OpenAI.
- `AZURE_OPENAI_O1_DEPLOYMENT` : The deployment name for the Azure OpenAI o1 model.
- `AZURE_OPENAI_GPT4O_DEPLOYMENT` : The deployment name for the Azure OpenAI gpt-4o model.
- `AZURE_OPENAI_API_KEY` : The API key for the Azure OpenAI.
