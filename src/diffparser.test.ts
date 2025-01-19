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
    // Let’s break down the lines in the new file:
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
    // So we ask findPositionInDiff for line=14, expecting it to return patch line=11.

    const result = findPositionInDiff(patch, 14);
    expect(result).toBe(11);
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

    // First hunk: "@@ -2,3 +2,4 @@"
    //   => new file lines start at 2, for 4 lines total
    //   => lines (in new file):
    //      #2 => " some"
    //      #3 => "-some old" (skipped because it's removed)
    //      #3 => "+some new" (the next new line)
    //      #4 => " and more"
    //
    // So that hunk covers newFileLines 2..5 effectively. (2,3,4,5)
    //   - #2 => " some"
    //   - #3 => +some new
    //   - #4 => " and more"  (the last line in that hunk)
    //
    // Second hunk: "@@ -10,2 +11,2 @@"
    //   => new file lines start at 11, for 2 lines
    //   => lines:
    //      #11 => "-other old" (skipped, removed)
    //      #11 => "+other new" => newFileLine=11
    //      #12 => " extra line" => newFileLine=12
    //
    // Let’s say we want new-file line 12 => " extra line".
    // That is the last line in the second hunk.
    // Checking the patch lines:
    //
    // 1: (blank)
    // 2: @@ -2,3 +2,4 @@
    // 3:  some              (line #2 in new file)
    // 4: -some old          (removed)
    // 5: +some new          (line #3 in new file)
    // 6:  and more          (line #4 in new file)
    // 7: @@ -10,2 +11,3 @@
    // 8: -other old         (removed)
    // 9: +other new         (line #11 in new file)
    // 10:  extra line       (line #12 in new file)
    //
    // So newFileLine=12 => patch line 10.
    // We'll confirm we can get a non-null from findPositionInDiff(...,12).

    const result = findPositionInDiff(patch, 12);
    expect(result).toBe(10); // line #10 in the patch
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

    // Hunk says: "@@ -14,6 +14,7 @@" => new lines start at line 14 for 7 lines
    // Let’s parse them:
    // newFileLine=14 => " line A"
    // newFileLine=15 => " line B"
    // newFileLine=16 => "+line C"
    // newFileLine=17 => " line D"
    //
    // We want the 3rd new-file line in that hunk => that's line #16 => the line that starts with "+"
    // Checking patch lines:
    // 1: (blank)
    // 2: diff --git ...
    // 3: index ...
    // 4: --- a/bar.js
    // 5: +++ b/bar.js
    // 6: @@ -14,6 +14,7 @@
    // 7: -removed line
    // 8:  line A   (newFileLine=14)
    // 9:  line B   (newFileLine=15)
    // 10: +line C  (newFileLine=16) <-- 3rd new-file line
    // 11:  line D  (newFileLine=17)
    //
    // So if we pass newFileLine=16 => we expect patch line=10, not null.

    const position = findPositionInDiff(patch, 16);
    expect(position).toBe(10);
  });
});
