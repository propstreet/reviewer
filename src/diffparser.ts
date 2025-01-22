/**
 * Finds the line position of a specified line number (newFileLine) within a unified diff patch.
 *
 * Algorithm explanation:
 * 1. Split the patch into lines and iterate through them.
 * 2. Ignore lines until the first '@@' hunk header is encountered.
 * 3. From that point on, increment a counter for each line that is an addition ("+") or unmodified line (" ").
 * 4. If the counter matches the target newFileLine, the position returned is how many lines have passed
 *    since the first '@@' hunk header.
 *
 * According to GitHub's specification:
 * "The position value equals the number of lines down from the first '@@' hunk header
 * in the file. The line just below the '@@' line is position 1, the next line is
 * position 2, and so on. The position in the diff continues to increase through
 * lines of whitespace and additional hunks until the beginning of a new file."
 *
 * @param patch       Unified diff string
 * @param newFileLine Line number in the "new" version of the file to locate
 * @param side        Side of the diff to search for the line
 * @returns           Position in the diff, or null if not found
 */
export function findPositionInDiff(
  patch: string,
  targetLine: number,
  side: "LEFT" | "RIGHT"
): number | null {
  // Split into lines
  const lines = patch.split("\n");

  // Tracks the current line number in the old file and new file
  let trackedOldLine = 0;
  let trackedNewLine = 0;

  // Indicates if we've encountered the first "@@" hunk header
  let hasFoundFirstHunk = false;

  // Zero-based index of the line where the first "@@" occurs
  let firstHunkLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect a hunk header, e.g. "@@ -123,4 +567,8 @@"
    if (line.startsWith("@@ ")) {
      // Attempt to parse the old/new line starts
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        // We only care about the starting line numbers, ignoring lengths for this purpose
        const oldStart = parseInt(match[1], 10);
        const newStart = parseInt(match[3], 10);

        trackedOldLine = oldStart - 1;
        trackedNewLine = newStart - 1;

        if (!hasFoundFirstHunk) {
          hasFoundFirstHunk = true;
          firstHunkLineIndex = i;
        }
      }

      continue;
    }

    // Skip lines until we've encountered the first "@@"
    if (!hasFoundFirstHunk) {
      continue;
    }

    // In a unified diff:
    //   - lines starting with " " appear in both old and new
    //   - lines starting with "-" only appear in old
    //   - lines starting with "+" only appear in new

    if (line.startsWith(" ")) {
      // Unmodified line on both sides
      trackedOldLine++;
      trackedNewLine++;
    } else if (line.startsWith("-")) {
      // Deleted line, only on old (LEFT)
      trackedOldLine++;
    } else if (line.startsWith("+")) {
      // Added line, only on new (RIGHT)
      trackedNewLine++;
    }

    // Check if we've hit the target line for the requested side
    if (side === "LEFT" && trackedOldLine === targetLine) {
      return i - firstHunkLineIndex;
    }
    if (side === "RIGHT" && trackedNewLine === targetLine) {
      return i - firstHunkLineIndex;
    }
  }

  // If we exhaust the patch lines without matching targetLine, return null
  return null;
}
