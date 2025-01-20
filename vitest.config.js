import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true, // Enable globals like describe, it, expect
    environment: "node", // Use Node.js test environment
    include: ["./**/*.test.ts"],
  },
});
//# sourceMappingURL=vitest.config.js.map
