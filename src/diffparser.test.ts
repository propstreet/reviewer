import {
  findPositionInDiff,
  verifyMultiLineCommentRange,
  parseDiff,
} from "./diffparser.js";

describe("findPositionInDiff", () => {
  describe("Single-hunk patches", () => {
    it("returns the correct position for a single-hunk patch (RIGHT side)", () => {
      const patch = `
diff --git a/foo.js b/foo.js
index abc1234..def5678 100644
--- a/foo.js
+++ b/foo.js
@@ -10,3 +10,5 @@
 console.log("old line");
 console.log("old line 2");
 console.log("old line 3");
+console.log("new line");
+console.log("new line 2");
`;
      // newFileLine=14 corresponds to the second added line (position=5).
      const result = findPositionInDiff(patch, 14, "RIGHT");
      expect(result).toBe(5);
    });

    it("returns null if the new-file line does not exist in a single-hunk patch (RIGHT side)", () => {
      const patch = `
@@ -1,2 +1,2 @@
-removed
 some
+added
`;

      // The hunk says "+1,2" => new file lines are 1 and 2 only.
      // Asking for line 3 => should return null.
      const result = findPositionInDiff(patch, 3, "RIGHT");
      expect(result).toBeNull();
    });

    it("returns correct position for the first non-removed line (RIGHT side)", () => {
      const patch = `
@@ -1,2 +1,2 @@
-removed
 some
+added
`;

      // "some" is newFileLine=1, but it's the second line in the diff after "@@"
      // So position should be 2.
      const result = findPositionInDiff(patch, 1, "RIGHT");
      expect(result).toBe(2);
    });

    it("returns the correct position for a removed line (LEFT side)", () => {
      const patch = `
@@ -1,2 +1,2 @@
-removed
 some
+added
`;
      // Here, the old file's line #1 is the "-removed" line.
      // After "@@", that's the second line in the diff (i=2),
      // but position is (2 - firstHunkLineIndex) => 1.
      const result = findPositionInDiff(patch, 1, "LEFT");
      expect(result).toBe(1);
    });
  });

  describe("Multi-hunk patches (GitHub's continuous position)", () => {
    it("maintains continuous position counting across hunks (RIGHT side)", () => {
      const patch = `
diff --git a/file.js b/file.js
index abc123..def456 100644
--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 line one
-old line
+new line
 line three
@@ -10,2 +11,3 @@
 other content
+added line
 final line`;

      // From first "@@":
      //   position 1 => line one
      //   position 2 => -old line
      //   position 3 => +new line
      //   position 4 => line three
      //   position 5 => @@ -10,2 +11,3 @@
      //   position 6 => other content
      //   position 7 => +added line
      //   position 8 => final line
      //
      // We'll check a few lines to confirm continuous counting (RIGHT side).
      const positions = [
        { line: 1, expected: 1 }, // "line one"
        { line: 2, expected: 3 }, // "new line" (skipping old line)
        { line: 3, expected: 4 }, // "line three"
        { line: 11, expected: 6 }, // "other content"
        { line: 12, expected: 7 }, // "added line"
        { line: 13, expected: 8 }, // "final line"
      ];

      for (const { line, expected } of positions) {
        expect(findPositionInDiff(patch, line, "RIGHT")).toBe(expected);
      }
    });

    it("maintains continuous position counting across hunks (LEFT side)", () => {
      const patch = `
diff --git a/file.js b/file.js
index abc123..def456 100644
--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 line one
-old line
+new line
 line three
@@ -10,2 +11,3 @@
 other content
+added line
 final line`;

      // Let's verify old-file lines (LEFT side). The old lines are:
      //   line 1 => "line one"
      //   line 2 => "old line"
      //   line 3 => "line three"
      //   line 10 => "other content"
      //   line 11 => "final line"
      // We'll confirm their diff positions (i - firstHunkLineIndex).
      const positions = [
        { line: 1, expected: 1 }, // "line one"
        { line: 2, expected: 2 }, // "old line"
        // "new line" is not on LEFT side, so skip
        { line: 3, expected: 4 }, // "line three"
        // Next hunk:
        { line: 10, expected: 6 }, // "other content"
        // line 11 => "final line"
        { line: 11, expected: 8 },
      ];

      for (const { line, expected } of positions) {
        expect(findPositionInDiff(patch, line, "LEFT")).toBe(expected);
      }
    });
  });

  describe("Edge cases", () => {
    it("ignores lines that do not match the hunk header pattern (RIGHT side)", () => {
      // The invalid '@@' line does not match /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
      // so it should be skipped entirely, effectively never counting lines.
      const patch = `
@@ -bogus-line +foo @@
+valid new line
 more lines
`;
      // Because the hunk header is bogus, we never set firstHunkLineIndex,
      // so we skip new-line counting. newFileLine=1 => null.
      expect(findPositionInDiff(patch, 1, "RIGHT")).toBeNull();
    });

    it("returns null for an empty patch (RIGHT side)", () => {
      expect(findPositionInDiff("", 1, "RIGHT")).toBeNull();
    });
  });
});

describe("verifyMultiLineCommentRange", () => {
  const samplePatch = `
@@ -1,5 +1,6 @@
 line one
 line two
+new line three
 line four
 line five
+new line six
`;

  it("returns positions for valid multi-line range (RIGHT side)", () => {
    // Lines 1-4 should be valid on RIGHT side
    const result = verifyMultiLineCommentRange(
      samplePatch,
      1,
      4,
      "RIGHT",
      "RIGHT"
    );
    expect(result).not.toBeNull();
    expect(result?.startPosition).toBe(1);
    expect(result?.endPosition).toBe(4);
  });

  it("returns null if start line is not found", () => {
    // Line 100 doesn't exist
    const result = verifyMultiLineCommentRange(
      samplePatch,
      100,
      4,
      "RIGHT",
      "RIGHT"
    );
    expect(result).toBeNull();
  });

  it("returns null if end line is not found", () => {
    // End line 100 doesn't exist
    const result = verifyMultiLineCommentRange(
      samplePatch,
      1,
      100,
      "RIGHT",
      "RIGHT"
    );
    expect(result).toBeNull();
  });

  it("returns null if start position is greater than end position", () => {
    // Reversed range (line 4 before line 1)
    const result = verifyMultiLineCommentRange(
      samplePatch,
      4,
      1,
      "RIGHT",
      "RIGHT"
    );
    expect(result).toBeNull();
  });

  it("handles single-line case (start equals end)", () => {
    // Single line (start = end)
    const result = verifyMultiLineCommentRange(
      samplePatch,
      2,
      2,
      "RIGHT",
      "RIGHT"
    );
    expect(result).not.toBeNull();
    expect(result?.startPosition).toBe(result?.endPosition);
  });

  it("handles LEFT side multi-line range", () => {
    const patchWithDeletions = `
@@ -1,4 +1,3 @@
 line one
-deleted line
 line three
 line four
`;
    // Lines 1-3 on LEFT side (old file)
    const result = verifyMultiLineCommentRange(
      patchWithDeletions,
      1,
      3,
      "LEFT",
      "LEFT"
    );
    expect(result).not.toBeNull();
  });

  describe("cross-hunk detection", () => {
    const multiHunkPatch = `@@ -1,3 +1,4 @@
 line one
-old line
+new line
 line three
@@ -10,2 +11,3 @@
 other content
+added line
 final line`;

    it("returns null when range spans across hunks (RIGHT side)", () => {
      // Line 3 is in hunk 0 (position 4), line 11 is in hunk 1 (position 6)
      // This should return null because they span different hunks
      const result = verifyMultiLineCommentRange(
        multiHunkPatch,
        3, // line three (hunk 0)
        11, // other content (hunk 1)
        "RIGHT",
        "RIGHT"
      );
      expect(result).toBeNull();
    });

    it("returns null when range spans across hunks (LEFT side)", () => {
      // Line 3 is in hunk 0, line 10 is in hunk 1
      const result = verifyMultiLineCommentRange(
        multiHunkPatch,
        3, // line three (hunk 0)
        10, // other content (hunk 1)
        "LEFT",
        "LEFT"
      );
      expect(result).toBeNull();
    });

    it("returns positions when range is within first hunk (RIGHT side)", () => {
      // Lines 1-3 are all in hunk 0
      const result = verifyMultiLineCommentRange(
        multiHunkPatch,
        1, // line one (hunk 0)
        3, // line three (hunk 0)
        "RIGHT",
        "RIGHT"
      );
      expect(result).not.toBeNull();
      expect(result?.startPosition).toBe(1);
      expect(result?.endPosition).toBe(4);
    });

    it("returns positions when range is within second hunk (RIGHT side)", () => {
      // Lines 11-13 are all in hunk 1
      const result = verifyMultiLineCommentRange(
        multiHunkPatch,
        11, // other content (hunk 1)
        13, // final line (hunk 1)
        "RIGHT",
        "RIGHT"
      );
      expect(result).not.toBeNull();
      expect(result?.startPosition).toBe(6);
      expect(result?.endPosition).toBe(8);
    });

    it("returns null when start line is at end of first hunk and end line is at start of second hunk", () => {
      // This is a boundary case - line 4 (hunk 0) to line 11 (hunk 1)
      const result = verifyMultiLineCommentRange(
        multiHunkPatch,
        4, // line four - doesn't exist in this patch, last line of hunk 0 content is line 3
        11,
        "RIGHT",
        "RIGHT"
      );
      // Line 4 doesn't exist in the diff, so this should return null
      expect(result).toBeNull();
    });
  });
});

describe("parseDiff", () => {
  it("correctly identifies hunk count", () => {
    const patch = `@@ -1,2 +1,2 @@
 line one
+added
@@ -10,1 +11,1 @@
 other`;

    const parsed = parseDiff(patch);

    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].index).toBe(0);
    expect(parsed.hunks[1].index).toBe(1);
  });

  it("associates lines with correct hunks", () => {
    const patch = `@@ -1,1 +1,1 @@
+first hunk line
@@ -10,1 +11,1 @@
+second hunk line`;

    const parsed = parseDiff(patch);

    const firstLine = parsed.newLineIndex.get(1);
    const secondLine = parsed.newLineIndex.get(11);

    expect(firstLine?.hunkIndex).toBe(0);
    expect(secondLine?.hunkIndex).toBe(1);
  });

  it("handles empty patch", () => {
    const parsed = parseDiff("");

    expect(parsed.hunks).toHaveLength(0);
    expect(parsed.lines.size).toBe(0);
    expect(parsed.oldLineIndex.size).toBe(0);
    expect(parsed.newLineIndex.size).toBe(0);
  });

  it("correctly maps line positions", () => {
    const patch = `@@ -1,3 +1,4 @@
 line one
-old line
+new line
 line three`;

    const parsed = parseDiff(patch);

    // Position 1 = "line one" (context)
    // Position 2 = "old line" (deletion)
    // Position 3 = "new line" (addition)
    // Position 4 = "line three" (context)

    expect(parsed.newLineIndex.get(1)?.position).toBe(1); // line one
    expect(parsed.newLineIndex.get(2)?.position).toBe(3); // new line
    expect(parsed.newLineIndex.get(3)?.position).toBe(4); // line three

    expect(parsed.oldLineIndex.get(1)?.position).toBe(1); // line one
    expect(parsed.oldLineIndex.get(2)?.position).toBe(2); // old line
    expect(parsed.oldLineIndex.get(3)?.position).toBe(4); // line three
  });

  it("correctly identifies line types", () => {
    const patch = `@@ -1,2 +1,2 @@
 context line
-deleted line
+added line`;

    const parsed = parseDiff(patch);

    expect(parsed.lines.get(0)?.type).toBe("hunk");
    expect(parsed.lines.get(1)?.type).toBe("context");
    expect(parsed.lines.get(2)?.type).toBe("deletion");
    expect(parsed.lines.get(3)?.type).toBe("addition");
  });
});
