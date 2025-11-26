# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2025-11-26

### Added
- **Azure OpenAI Responses API (v1)** - Migrated from `beta.chat.completions.parse` to the new `responses.parse` API
- **GPT-5 support** with `minimal` reasoning effort level (in addition to `low`, `medium`, `high`)
- **Multi-line review comments** - Comments can now span multiple lines with `start_line`/`start_side` fields
- **Custom instructions** - New `customPrompt` input to append custom LLM instructions (max 1000 chars)
- `lint:fix` and `format` npm scripts for code formatting

### Changed
- **OpenAI SDK v4 → v6** - Major upgrade to latest OpenAI SDK
- **Removed `@azure/openai` dependency** - Now uses standard `openai` SDK with Azure v1 endpoint
- **Default Azure API version** updated to `preview` (simplified for v1 endpoint)
- System prompt updated to guide LLM on multi-line comment format
- Improved error messages and debug logging

### Breaking Changes
- Azure deployments must support the Responses API (v1 endpoint: `{endpoint}/openai/v1/responses`)
- Schema for review comments now requires `start_line` and `start_side` fields
  - For single-line comments: `start_line = line` and `start_side = side`
  - For multi-line comments: `start_line`/`start_side` mark the beginning of the range

### Migration from v2

1. **Update your Azure deployment** to support the Responses API
2. **Update your workflow** to use `v3`:
   ```yaml
   - uses: propstreet/reviewer@v3
   ```
3. **Optional**: Use new `customPrompt` input for custom instructions:
   ```yaml
   - uses: propstreet/reviewer@v3
     with:
       customPrompt: "Focus on security issues and performance"
   ```

## [2.0.0] - 2025-02-XX

### Added
- Initial release with Azure OpenAI support
- Structured output with Zod validation
- Commit verification to ensure comments belong to PR
- Token limit management
- File exclusion patterns
- Severity-based review filtering
