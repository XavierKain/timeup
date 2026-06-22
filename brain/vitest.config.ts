import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Each integration test creates its own temp DB; no global setup needed.
    pool: "forks",
  },
});
