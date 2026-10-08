import { defineConfig } from 'vitest/config';

/**
 * Timezone is pinned for the same reason as the frontend suite (MUT-17):
 * date-sensitive ledger rules must not depend on the developer's machine.
 */
const TZ = process.env.TZ || 'Asia/Jerusalem';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    env: { TZ },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/scripts/**', 'src/index.ts', 'src/test/**'],
    },
  },
});
