import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import base from '../../vite.config';

/**
 * Every Vite dev server a release-QA app starts goes through this config (MUT-440; MUT-291 did it for the
 * carry-over app first). A QA env runs several at once (web, portal, portal-live, the carry-over's three):
 * sharing one dependency cache, each re-optimised the others' dependencies and reloaded their pages mid-test,
 * or loaded chunks from two optimiser generations (two Reacts: "Cannot read properties of null (reading
 * 'useState')" on every second run). Each server gets its own cache, named by QA_VITE_ROLE, and ignores the
 * run's own files (qa/runs) and what the other apps build or write (qa/.state).
 */
export default defineConfig((env: ConfigEnv) =>
  mergeConfig((base as unknown as (env: ConfigEnv) => UserConfig)(env), {
    cacheDir: `node_modules/.vite-qa-${process.env.QA_VITE_ROLE ?? 'default'}`,
    server: { watch: { ignored: ['**/qa/runs/**', '**/qa/.state/**'] } },
  }),
);
