import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Integration tests hit a real Postgres test DB — run serially to
    // avoid cross-test interference from shared tables.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
