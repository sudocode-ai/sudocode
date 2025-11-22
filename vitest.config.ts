import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      './cli/vitest.config.ts',
      './mcp/vitest.config.ts',
      './server/vitest.config.ts',
      './frontend/vitest.config.ts',
    ],
  },
});
