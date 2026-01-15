import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 120000,
    hookTimeout: 60000,
    teardownTimeout: 30000,
    isolate: true,
    pool: "forks",
    retry: 3, // Retry failed tests up to 3 times for flakes.
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
