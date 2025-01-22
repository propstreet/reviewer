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
      "The line of the blob in the pull request diff that the comment applies to.",
  }),
  side: z.enum(["LEFT", "RIGHT"], {
    description:
      "In a split diff view, the side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context.",
  }),
  comment: z.string({ description: "The text of the review comment." }),
  severity: z.enum(["info", "warning", "error"]),
});

// Define an array of them
export const CodeReviewCommentArray = z.object({
  comments: z.array(CodeReviewComment),
});
