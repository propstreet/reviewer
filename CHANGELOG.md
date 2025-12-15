# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.4.1] - 2025-12-16

### Changed
- **Renamed action** - Action renamed from "AI PR Reviewer" to "Pro PR Reviewer"
- **Added branding** - Added icon and color for GitHub Marketplace listing

## [3.4.0] - 2025-12-15

### Added
- **`skipMergeCommits` input** - New configurable option to control merge commit handling (default: `true`). Set to `false` to review merge commits if needed.
- **Boolean input validators** - Added `isValidBooleanInput()` and `parseBooleanInput()` helpers for input validation.

### Fixed
- **Skip merge commits during review** - Fixed "Path could not be resolved, Line could not be resolved" errors after merging master into a feature branch. Merge commits are now automatically skipped since their diffs represent merge resolution changes that have already been reviewed in their original PRs.

### Changed
- **Optimized API usage** - Merge commit detection now uses `parentCount` from `compareCommits` response, avoiding extra `getCommitDetails` API calls for commits that will be skipped.

## [3.3.1] - 2025-12-02

### Fixed
- **Improved error message for missing SHAs** - Error now shows detected action type, supported actions list, and suggests using explicit `base`/`head` inputs
- **Added debug logging** - Logs detected action and resolved SHAs to help troubleshoot configuration issues

### Added
- **Support for `reopened` event** - PRs that are reopened now trigger reviews automatically
- **Support for `ready_for_review` event** - Draft PRs marked ready now trigger reviews automatically

## [3.3.0] - 2025-11-27

### Fixed
- **Multi-hunk comment validation** - Fixed GitHub API error "Pull request review thread start line must be part of the same hunk as the line" (422 Unprocessable Entity). Multi-line comments spanning multiple hunks now gracefully fall back to issue comments.

### Added
- **Single-pass diff parser** - New `parseDiff()` function that extracts all structural information including hunk boundaries in one pass
- **Hunk boundary tracking** - Each parsed line now includes a `hunkIndex` for detecting cross-hunk ranges
- **10 new test cases** - Comprehensive coverage for cross-hunk detection and `parseDiff()` functionality

### Changed
- **Refactored `findPositionInDiff()`** - Now uses `parseDiff()` internally for improved performance
- **Refactored `verifyMultiLineCommentRange()`** - Now compares `hunkIndex` values to detect invalid cross-hunk ranges

## [3.2.0] - 2025-11-26

### Added
- **Background mode for long-running reviews** - New async polling mode for models that take 15+ minutes (like GPT-5-Pro with high reasoning effort):
  - `backgroundMode: enabled` - Enable background polling mode
  - `backgroundMaxWait: 30` - Maximum wait time in minutes (1-60)
  - `backgroundPollInterval: 10` - Initial polling interval in seconds (5-60)
  - Uses OpenAI Responses API `background: true` with automatic exponential backoff polling
  - Automatic request cancellation on timeout

### Changed
- **DRY refactoring** - Introduced `parseIntInRange` and `formatError` helper functions
- **Exported constants** - Background polling configuration constants now exported from validators

### Security
- **Hardened Azure endpoint validation** - Validates proper HTTP/HTTPS URL format
- **Hardened Azure API key validation** - Minimum 16 chars, rejects whitespace and control characters
- **Hardened Azure deployment validation** - Validates Azure naming pattern (alphanumeric, `._()-`)
- **Improved exclude pattern validation** - Added null byte injection prevention

## [3.1.0] - 2025-11-26

### Fixed
- **Comment validation for multi-commit PRs** - Fixed bug where inline review comments on files modified in multiple commits would fail validation and be demoted to issue comments. The validation now uses the cumulative PR diff (base...HEAD) instead of per-commit patches, matching GitHub's actual validation behavior when posting reviews.

## [3.0.0] - 2025-11-26

### Added
- **Azure OpenAI Responses API (v1)** - Migrated from `beta.chat.completions.parse` to the new `responses.parse` API
- **GPT-5 support** with `minimal` reasoning effort level (in addition to `low`, `medium`, `high`)
- **Multi-line review comments** - Comments can now span multiple lines with `start_line`/`start_side` fields
- **Custom instructions** - New `customPrompt` input to append custom LLM instructions (max 1000 chars)
- `lint:fix` and `format` npm scripts for code formatting

### Fixed
- **[P0] Single PR review model** - Now submits ONE review per PR instead of multiple per-commit reviews. This fixes:
  - `REQUEST_CHANGES` status being cleared by subsequent `COMMENT` review
  - GitHub error: "Pull request review thread line must be part of the diff and Pull request review thread diff hunk can't be blank"
  - State-flip issue where errors on commit 1 were overridden by clean commit 5
- **[P1] Continue processing after skip** - When a commit cannot be packed (all files excluded or over token limit), the action now continues reviewing subsequent commits instead of aborting
- **[P3] commitLimit now enforced** - The `commitLimit` input was validated but never applied; now correctly limits to the N most recent commits

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
