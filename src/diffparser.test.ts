import { findPositionInDiff } from "./diffparser.js";

describe("findPositionInDiff (Realistic GitHub Offsets)", () => {
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

    // The hunk says "+10,5", meaning new lines start at line 10 (and it has 5 new lines).
    // Let's break down the lines in the new file:
    //
    // newFileLine=10 => " console.log(\"old line\");"
    // newFileLine=11 => " console.log(\"old line 2\");"
    // newFileLine=12 => " console.log(\"old line 3\");"
    // newFileLine=13 => "+console.log(\"new line\");"
    // newFileLine=14 => "+console.log(\"new line 2\");"
    //
    // If we want the "second added line," that is newFileLine=14.
    // Which patch line is that? Let's count:
    //  1: (blank)
    //  2: diff --git ...
    //  3: index ...
    //  4: --- ...
    //  5: +++ ...
    //  6: @@ ...
    //  7:  console.log("old line");   (newFileLine=10)
    //  8:  console.log("old line 2"); (newFileLine=11)
    //  9:  console.log("old line 3"); (newFileLine=12)
    // 10: +console.log("new line");   (newFileLine=13)
    // 11: +console.log("new line 2"); (newFileLine=14) <-- We want this
    //
    // So we ask findPositionInDiff for line=14, expecting it to return patch position=5.

    const result = findPositionInDiff(patch, 14);
    expect(result).toBe(5);
  });

  it("returns null if the new-file line does not exist in the patch", () => {
    const patch = `
@@ -1,2 +1,2 @@
-removed
 some
+added
`;

    // The hunk says "+1,2", meaning new lines start at line 1 (2 lines total).
    // newFileLine=1 => " some"
    // newFileLine=2 => "+added"
    // If we ask for line 3, that doesn't exist => should return null

    const result = findPositionInDiff(patch, 3);
    expect(result).toBeNull();
  });

  it("correctly handles multiple hunks and hunk headers", () => {
    const patch = `
@@ -2,3 +2,4 @@
 some
-some old
+some new
 and more
@@ -10,2 +11,2 @@
-other old
+other new
 extra line
`;

    // According to GitHub's specification:
    // Position counting starts at 1 for the first line after the first @@.
    // Let's count positions from the first @@ line:
    // 1: (blank)                  [skip - before first @@]
    // 2: @@ -2,3 +2,4 @@         [first @@ - start counting after this]
    // 3:  some              [Position 1]
    // 4: -some old          [Position 2]
    // 5: +some new          [Position 3]
    // 6:  and more          [Position 4]
    // 7: @@ -10,2 +11,2 @@  [Position 5]
    // 8: -other old         [Position 6]
    // 9: +other new         [Position 7]
    // 10:  extra line       [Position 8] <-- We want this one (newFileLine=12)

    const result = findPositionInDiff(patch, 12);
    expect(result).toBe(8); // Position 8 in the patch (8 lines after first @@)
  });

  it("skips lines that start with diff --git, index, --- or +++", () => {
    const patch = `
diff --git a/bar.js b/bar.js
index 1234567..7654321 100644
--- a/bar.js
+++ b/bar.js
@@ -14,6 +14,7 @@
-removed line
 line A
 line B
+line C
 line D
`;

    // According to GitHub's specification:
    // Position counting starts at 1 for the first line after the first @@.
    // Let's count positions from the first @@ line:
    // 1: (blank)                  [skip - before first @@]
    // 2: diff --git ...          [skip - before first @@]
    // 3: index ...               [skip - before first @@]
    // 4: --- a/bar.js            [skip - before first @@]
    // 5: +++ b/bar.js            [skip - before first @@]
    // 6: @@ -14,6 +14,7 @@      [first @@ - start counting after this]
    // 7: -removed line           [Position 1]
    // 8:  line A   (line 14)     [Position 2]
    // 9:  line B   (line 15)     [Position 3]
    // 10: +line C  (line 16)     [Position 4] <-- We want this one
    // 11:  line D  (line 17)     [Position 5]

    const position = findPositionInDiff(patch, 16);
    expect(position).toBe(4);
  });

  it("maintains continuous position counting across hunks per GitHub spec", () => {
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

    // According to GitHub's specification:
    // "The position value equals the number of lines down from the first '@@' hunk header
    // in the file. The line just below the '@@' line is position 1, the next line is
    // position 2, and so on. The position in the diff continues to increase through
    // lines of whitespace and additional hunks until the beginning of a new file."
    //
    // Let's count positions from the first @@ line:
    // 1: diff --git ...       [skip - before first @@]
    // 2: index ...            [skip - before first @@]
    // 3: --- ...              [skip - before first @@]
    // 4: +++ ...              [skip - before first @@]
    // 5: @@ -1,3 +1,4 @@     [First @@ - start counting after this]
    // 6:  line one           [Position 1]
    // 7: -old line           [Position 2]
    // 8: +new line           [Position 3]
    // 9:  line three         [Position 4]
    // 10: @@ -10,2 +11,3 @@  [Position 5]
    // 11:  other content     [Position 6]
    // 12: +added line        [Position 7]
    // 13:  final line        [Position 8]

    // Test positions across both hunks to verify continuous counting
    const positions = [
      { line: 1, expectedPosition: 1 }, // "line one" in first hunk
      { line: 2, expectedPosition: 3 }, // "new line" in first hunk
      { line: 3, expectedPosition: 4 }, // "line three" in first hunk
      { line: 11, expectedPosition: 6 }, // "other content" in second hunk
      { line: 12, expectedPosition: 7 }, // "added line" in second hunk
      { line: 13, expectedPosition: 8 }, // "final line" in second hunk
    ];

    // Verify each position matches GitHub's specification
    for (const { line, expectedPosition } of positions) {
      const result = findPositionInDiff(patch, line);
      expect(result).toBe(expectedPosition);
    }
  });
});
