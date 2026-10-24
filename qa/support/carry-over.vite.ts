import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import base from '../../vite.config';

/**
 * MUT-291: the carry-over QA app runs three Vite dev servers at once (support/carry-over.mjs). Sharing one dependency
 * cache, each re-optimised the others' dependencies and reloaded their pages mid-test, and the web server reloaded on
 * the run's own files under qa/runs/. Each server gets its own cache (CARRY_OVER_ROLE names it) and ignores qa/runs.
 */
export default defineConfig((env: ConfigEnv) =>
  mergeConfig((base as unknown as (env: ConfigEnv) => UserConfig)(env), {
    cacheDir: `node_modules/.vite-carry-over-${process.env.CARRY_OVER_ROLE ?? 'default'}`,
    server: { watch: { ignored: ['**/qa/runs/**', '**/qa/.state/**'] } },
  }),
);
