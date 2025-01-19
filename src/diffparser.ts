/**
 * Given a file patch, and a "target line" in the new file,
 * return the 1-based diff "position" for that line.
 * If not found, return null.
 *
 * Patch lines look like:
 *   @@ -14,6 +14,7 @@ ...
 *   - console.log("old");
 *   + console.log("new code");
 *   ...
 * Lines that begin with `+` or ` ` count toward the "new file" line number.
 */
export function findPositionInDiff(patch: string, newFileLine: number): number | null {
    let position = 0;          // overall line index in the patch (1-based)
    let currentNewLine = 0;    // tracks the new file line as we parse
  
    const lines = patch.split("\n");
    for (const line of lines) {
      position++;
  
      // If it's a hunk header, parse the new-file line range.
      //   e.g. "@@ -14,6 +14,7 @@"
      //   means old start=14, old count=6, new start=14, new count=7
      if (line.startsWith("@@ ")) {
        // Extract after the "@@ -"
        // Typically it's "-start,count +start,count @@"
        // We'll do a quick parse
        const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (m) {
          const start = parseInt(m[1], 10);
          // If there's a chunk size, we might not necessarily need it here
          currentNewLine = start - 1; // we'll increment on the next line
        }
        continue;
      }
  
      // If it's a removal line ("-something"), it does NOT affect new-file line numbers
      if (line.startsWith("-")) {
        continue;
      }
  
      // If it's an addition ("+something") or context (" something"),
      // the new file line number increments
      currentNewLine++;
  
      // Check if we just hit the target line
      if (currentNewLine === newFileLine) {
        return position;
      }
    }
  
    return null; // not found in this patch
  }
  