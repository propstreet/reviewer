// src/schemas.ts
import { z } from "zod";

// Define a single comment
export const CodeReviewComment = z.object({
  sha: z.string({ description: "The SHA of the commit needing a comment." }),
  file: z.string({
    description: "The relative path to the file that necessitates a comment.",
  }),
  line: z.number({
    description:
      "The ending line of the comment in the pull request diff. For single-line comments, this equals start_line.",
  }),
  side: z.enum(["LEFT", "RIGHT"], {
    description:
      "The side of the diff for the ending line. Can be LEFT (deletions/red) or RIGHT (additions/green or context). For single-line comments, this equals start_side.",
  }),
  start_line: z.number({
    description:
      "The starting line of the comment range. For single-line comments, set this equal to line.",
  }),
  start_side: z.enum(["LEFT", "RIGHT"], {
    description:
      "The side of the diff for the starting line. For single-line comments, set this equal to side.",
  }),
  comment: z.string({ description: "The text of the review comment." }),
  severity: z.enum(["info", "warning", "error"]),
});

// Define an array of them
export const CodeReviewCommentArray = z.object({
  comments: z.array(CodeReviewComment),
});

// Export inferred types from Zod schemas
export type ReviewResult = z.infer<typeof CodeReviewCommentArray>;
