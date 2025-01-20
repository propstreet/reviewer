import { findPositionInDiff } from "./diffparser.js";

describe("findPositionInDiff", () => {
  describe("Single-hunk patches", () => {
    it("returns the correct position for a single-hunk patch", () => {
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
      const result = findPositionInDiff(patch, 14);
      expect(result).toBe(5);
    });

    it("returns null if the new-file line does not exist in a single-hunk patch", () => {
      const patch = `
@@ -1,2 +1,2 @@
-removed
 some
+added
`;

      // The hunk says "+1,2" => new file lines are 1 and 2 only.
      // Asking for line 3 => should return null.
      const result = findPositionInDiff(patch, 3);
      expect(result).toBeNull();
    });

    it("returns correct position for the first non-removed line", () => {
      const patch = `
@@ -1,2 +1,2 @@
-removed
 some
+added
`;

      // "some" is newFileLine=1, but it's the second line in the diff after "@@"
      // So position should be 2.
      const result = findPositionInDiff(patch, 1);
      expect(result).toBe(2);
    });
  });

  describe("Multi-hunk patches (GitHub's continuous position)", () => {
    it("maintains continuous position counting across hunks", () => {
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
      // We'll check a few lines to confirm continuous counting.
      const positions = [
        { line: 1, expected: 1 }, // "line one"
        { line: 2, expected: 3 }, // "new line"
        { line: 3, expected: 4 }, // "line three"
        { line: 11, expected: 6 }, // "other content"
        { line: 12, expected: 7 }, // "added line"
        { line: 13, expected: 8 }, // "final line"
      ];

      for (const { line, expected } of positions) {
        expect(findPositionInDiff(patch, line)).toBe(expected);
      }
    });
  });

  describe("Edge cases", () => {
    it("ignores lines that do not match the hunk header pattern", () => {
      // The invalid '@@' line does not match /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
      // so it should be skipped entirely, effectively never counting lines.
      const patch = `
@@ -bogus-line +foo @@
+valid new line
 more lines
`;
      // Because the hunk header is bogus, we never set the firstHunkLineIndex, so we skip new-line counting.
      // This means newFileLine=1 won't be found; expect null.
      expect(findPositionInDiff(patch, 1)).toBeNull();
    });

    it("returns null for an empty patch", () => {
      expect(findPositionInDiff("", 1)).toBeNull();
    });
  });
});
