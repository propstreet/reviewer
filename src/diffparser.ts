/**
 * findPositionInDiff:
 *   Maps "new file" line numbers to 1-based patch line positions,
 *   consistent with how GitHub diffs usually track them.
 *
 * Algorithm:
 * 1. We ignore everything until we see a hunk header line: "@@ -oldStart,oldCount +newStart,newCount @@"
 *    - Once we see a hunk header, set `currentNewLine = newStart - 1`.
 *    - Mark `inHunk = true` so we know subsequent lines are part of this hunk.
 *
 * 2. Inside a hunk:
 *    - If line starts with '-', it's an old-file line => does not increment.
 *    - If line starts with '+' or ' ' (a space), it belongs to the new file => increment currentNewLine.
 *    - If currentNewLine matches `newFileLine`, return the patch line index (1-based).
 *
 * 3. If we hit another "@@" line, that starts a new hunk (repeat step 1).
 * 4. Skip metadata lines ("diff --git", "index ", "--- ", "+++ ") outside hunks.
 *    (We also skip them if they're inside a hunk, which is rare, but just in case.)
 *
 * 5. If we never find newFileLine, return null.
 */
export function findPositionInDiff(
  patch: string,
  newFileLine: number
): number | null {
  let position = 0; // 1-based index of the current line in the patch
  let currentNewLine = 0; // how many lines we've seen in the new file so far
  let inHunk = false; // are we inside a recognized hunk?

  const lines = patch.split("\n");
  for (const line of lines) {
    position++;

    // 1) Hunk header check: "@@ -oldStart,oldCount +newStart,newCount @@"
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[1], 10);
        currentNewLine = newStart - 1;
        inHunk = true; // subsequent lines belong to this hunk
      }
      continue;
    }

    // 2) If we're not in a hunk yet, skip everything else
    //    (like "diff --git", "index ", or blank lines).
    if (!inHunk) {
      continue;
    }

    // 3) Inside a hunk, skip lines that start with '-' (removed)
    if (line.startsWith("-")) {
      continue;
    }

    // 4) Also skip any patch metadata that might appear inside a hunk (rare but possible)
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }

    // 5) If the line starts with '+' or ' ' => it is a line in the new file
    if (line.startsWith("+") || line.startsWith(" ")) {
      currentNewLine++;
      if (currentNewLine === newFileLine) {
        return position; // the 1-based index of this line in the patch
      }
    }
  }

  // If we never matched newFileLine, return null
  return null;
}
