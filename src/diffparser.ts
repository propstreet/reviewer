/**
 * Represents a parsed line from a unified diff
 */
interface DiffLine {
  /** Position in the diff (1-indexed from first @@ header) */
  position: number;
  /** Line number in the old file (LEFT side), or null if not applicable */
  oldLine: number | null;
  /** Line number in the new file (RIGHT side), or null if not applicable */
  newLine: number | null;
  /** Type of line: context, addition, deletion, or hunk header */
  type: "context" | "addition" | "deletion" | "hunk";
  /** Index of the hunk this line belongs to (0-indexed) */
  hunkIndex: number;
}

/**
 * Represents a parsed hunk from a unified diff
 */
interface ParsedHunk {
  /** 0-indexed hunk number */
  index: number;
  /** Position of the @@ line in the diff */
  headerPosition: number;
  /** Starting line number in old file */
  oldStart: number;
  /** Starting line number in new file */
  newStart: number;
}

/**
 * Complete parsed representation of a unified diff
 */
interface ParsedDiff {
  /** All parsed lines indexed by position */
  lines: Map<number, DiffLine>;
  /** All hunks in order */
  hunks: ParsedHunk[];
  /** Quick lookup: old line number -> DiffLine */
  oldLineIndex: Map<number, DiffLine>;
  /** Quick lookup: new line number -> DiffLine */
  newLineIndex: Map<number, DiffLine>;
}

/**
 * Parses a unified diff patch into a structured representation.
 * Single-pass parser that extracts all structural information including hunk boundaries.
 *
 * @param patch  Unified diff string
 * @returns      Parsed diff structure with line and hunk information
 */
export function parseDiff(patch: string): ParsedDiff {
  const lines = patch.split("\n");
  const result: ParsedDiff = {
    lines: new Map(),
    hunks: [],
    oldLineIndex: new Map(),
    newLineIndex: new Map(),
  };

  let trackedOldLine = 0;
  let trackedNewLine = 0;
  let hasFoundFirstHunk = false;
  let firstHunkLineIndex = -1;
  let currentHunkIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect a hunk header, e.g. "@@ -123,4 +567,8 @@"
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const newStart = parseInt(match[3], 10);

        trackedOldLine = oldStart - 1;
        trackedNewLine = newStart - 1;

        if (!hasFoundFirstHunk) {
          hasFoundFirstHunk = true;
          firstHunkLineIndex = i;
        }

        currentHunkIndex++;
        const position = i - firstHunkLineIndex;

        result.hunks.push({
          index: currentHunkIndex,
          headerPosition: position,
          oldStart,
          newStart,
        });

        result.lines.set(position, {
          position,
          oldLine: null,
          newLine: null,
          type: "hunk",
          hunkIndex: currentHunkIndex,
        });
      }
      continue;
    }

    // Skip lines until we've encountered the first "@@"
    if (!hasFoundFirstHunk) {
      continue;
    }

    const position = i - firstHunkLineIndex;
    let diffLine: DiffLine;

    if (line.startsWith(" ")) {
      // Context line - appears in both old and new
      trackedOldLine++;
      trackedNewLine++;
      diffLine = {
        position,
        oldLine: trackedOldLine,
        newLine: trackedNewLine,
        type: "context",
        hunkIndex: currentHunkIndex,
      };
      result.oldLineIndex.set(trackedOldLine, diffLine);
      result.newLineIndex.set(trackedNewLine, diffLine);
    } else if (line.startsWith("-")) {
      // Deleted line - only in old file (LEFT)
      trackedOldLine++;
      diffLine = {
        position,
        oldLine: trackedOldLine,
        newLine: null,
        type: "deletion",
        hunkIndex: currentHunkIndex,
      };
      result.oldLineIndex.set(trackedOldLine, diffLine);
    } else if (line.startsWith("+")) {
      // Added line - only in new file (RIGHT)
      trackedNewLine++;
      diffLine = {
        position,
        oldLine: null,
        newLine: trackedNewLine,
        type: "addition",
        hunkIndex: currentHunkIndex,
      };
      result.newLineIndex.set(trackedNewLine, diffLine);
    } else {
      // Unknown line type (e.g., "\ No newline at end of file")
      continue;
    }

    result.lines.set(position, diffLine);
  }

  return result;
}

/**
 * Finds the line position of a specified line number within a unified diff patch.
 *
 * According to GitHub's specification:
 * "The position value equals the number of lines down from the first '@@' hunk header
 * in the file. The line just below the '@@' line is position 1, the next line is
 * position 2, and so on. The position in the diff continues to increase through
 * lines of whitespace and additional hunks until the beginning of a new file."
 *
 * @param patch       Unified diff string
 * @param targetLine  Line number in the "side" of the file to locate
 * @param side        Side of the diff to search for the line
 * @returns           Position in the diff, or null if not found
 */
export function findPositionInDiff(
  patch: string,
  targetLine: number,
  side: "LEFT" | "RIGHT"
): number | null {
  const parsed = parseDiff(patch);
  const index = side === "LEFT" ? parsed.oldLineIndex : parsed.newLineIndex;
  return index.get(targetLine)?.position ?? null;
}

/**
 * Verifies if a multi-line comment range is valid within a diff patch.
 *
 * GitHub requires that multi-line comments have both start and end lines
 * within the same hunk. This function validates that constraint by parsing
 * the diff and comparing hunk indices.
 *
 * @param patch       Unified diff string
 * @param startLine   Starting line number in the file
 * @param endLine     Ending line number in the file
 * @param startSide   Side of the diff for the starting line
 * @param endSide     Side of the diff for the ending line
 * @returns           Object with start and end positions, or null if invalid
 */
export function verifyMultiLineCommentRange(
  patch: string,
  startLine: number,
  endLine: number,
  startSide: "LEFT" | "RIGHT",
  endSide: "LEFT" | "RIGHT"
): { startPosition: number; endPosition: number } | null {
  const parsed = parseDiff(patch);

  const startIndex =
    startSide === "LEFT" ? parsed.oldLineIndex : parsed.newLineIndex;
  const endIndex =
    endSide === "LEFT" ? parsed.oldLineIndex : parsed.newLineIndex;

  const startDiffLine = startIndex.get(startLine);
  const endDiffLine = endIndex.get(endLine);

  // Both lines must exist in the diff
  if (!startDiffLine || !endDiffLine) {
    return null;
  }

  // Start position must come before or equal to end position
  if (startDiffLine.position > endDiffLine.position) {
    return null;
  }

  // Both lines must be in the same hunk (GitHub API requirement)
  if (startDiffLine.hunkIndex !== endDiffLine.hunkIndex) {
    return null;
  }

  return {
    startPosition: startDiffLine.position,
    endPosition: endDiffLine.position,
  };
}
