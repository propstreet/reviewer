// src/schemas.ts
import { z } from "zod";

// Define a single comment
export const CodeReviewComment = z.object({
  file: z.string(),
  line: z.number(),
  comment: z.string(),
});

// Define an array of them
export const CodeReviewCommentArray = z.object({
  comments: z.array(CodeReviewComment),
});
