import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Pin the timezone so date-sensitive tests are deterministic.
 *
 * Without this, results depend on the developer's machine: the suite passes in
 * UTC+n and fails in UTC-n (see MUT-17). Asia/Jerusalem is the default because
 * it is the primary user timezone and observes DST. Override to test other
 * zones -- `npm run test:tz` runs the suite west of UTC.
 */
const TZ = process.env.TZ || 'Asia/Jerusalem';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.ts'],
    env: { TZ },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
