import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    globals: true,
    // Increase timeouts for slow CLI tests
    testTimeout: 120_000, // 2 minutes per test
    hookTimeout: 30_000, // 30 seconds for setup/teardown
    // Increase pool timeout for long-running test files
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Run tests serially to avoid CLI conflicts
      },
    },
  },
});
