"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeReviewCommentArray = exports.CodeReviewComment = void 0;
// src/schemas.ts
const zod_1 = require("zod");
// Define a single comment
exports.CodeReviewComment = zod_1.z.object({
    file: zod_1.z.string(),
    line: zod_1.z.number(),
    comment: zod_1.z.string(),
});
// Define an array of them
exports.CodeReviewCommentArray = zod_1.z.array(exports.CodeReviewComment);
//# sourceMappingURL=schemas.js.map