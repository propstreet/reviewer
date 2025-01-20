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
  let currentNewLine = 0; // tracks current line number in the new file
  let firstHunkFound = false; // have we found the first @@ line?
  let firstHunkIndex = -1; // index of the first @@ line
  let currentIndex = -1; // current line index

  const lines = patch.split("\n");
  for (const line of lines) {
    currentIndex++;

    // Handle @@ lines specially
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[1], 10);
        currentNewLine = newStart - 1;
        if (!firstHunkFound) {
          firstHunkFound = true;
          firstHunkIndex = currentIndex;
        }
      }
      continue;
    }

    // Skip everything before first @@ line
    if (!firstHunkFound) {
      continue;
    }

    // Process new file lines after first @@
    if (line.startsWith("+") || line.startsWith(" ")) {
      currentNewLine++;
      if (currentNewLine === newFileLine) {
        // Position is the number of lines after the first @@ line
        return currentIndex - firstHunkIndex;
      }
    }
  }

  // If we never matched newFileLine, return null
  return null;
}
