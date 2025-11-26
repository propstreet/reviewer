/**
 * Prompt for PR code review using GPT-5 reasoning model.
 * Uses the Responses API with structured output.
 */
export default function (context) {
  const { commitMessage, diff, customPrompt } = context.vars;

  let systemContent = `You are a helpful code reviewer. Review this pull request and provide any suggestions.
Each comment must include: sha, file, start_line, start_side, line, side, comment, and severity ('info', 'warning', or 'error').

For single-line comments: set start_line = line and start_side = side.
For multi-line comments: start_line/start_side is the first line, line/side is the last line.

Only comment on lines that need improvement. Comments may be formatted as markdown.
If you have no comments, return an empty comments array. Respond in JSON format.`;

  // Append custom instructions if provided
  if (customPrompt) {
    systemContent += `\n\n## Additional Instructions\n${customPrompt}`;
  }

  return [
    {
      role: "developer",
      content: systemContent,
    },
    {
      role: "user",
      content: `# ${commitMessage}\n\n${diff}`,
    },
  ];
}
