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
 * @returns           Position in the diff, or null if not found
 */
export function findPositionInDiff(
  patch: string,
  newFileLine: number
): number | null {
  // Split into lines
  const lines = patch.split("\n");

  // Tracks the current line number in the new file
  let trackedNewLine = 0;

  // Indicates if we've encountered the first "@@" hunk header
  let hasFoundFirstHunk = false;

  // Zero-based index of the line where the first "@@" occurs
  let firstHunkLineIndex = -1;

  // We'll iterate with a standard index for clarity
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // When we reach a hunk header (e.g. "@@ -123,4 +567,8 @@")
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);

      // If we parse it successfully, update our trackedNewLine
      if (match) {
        const newStart = parseInt(match[1], 10);
        trackedNewLine = newStart - 1;

        // Mark the index of this first hunk (for calculating offsets later)
        if (!hasFoundFirstHunk) {
          hasFoundFirstHunk = true;
          firstHunkLineIndex = i;
        }
      }

      // Done processing this line, move on
      continue;
    }

    // Skip lines until we've encountered the first "@@" line
    if (!hasFoundFirstHunk) {
      continue;
    }

    // For lines in the actual diff segment, we increment the tracked new-file line
    // on lines that are added or unmodified ("+" or " ")
    if (line.startsWith("+") || line.startsWith(" ")) {
      trackedNewLine++;

      // When we hit the exact newFileLine, return how many lines we've progressed
      // from the first hunk line.
      if (trackedNewLine === newFileLine) {
        return i - firstHunkLineIndex;
      }
    }
  }

  // If we exhaust the patch lines without matching newFileLine, return null
  return null;
}
