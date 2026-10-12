/**
 * Playwright config for release-qa — scaffolded by `release-qa init`; owned by this project.
 * Run through the engine (`release-qa run …`), which sets QA_CONTEXT: base URLs, personas,
 * where videos go, and whether this is the warm-up pass.
 *
 * mini-crm has no auth, so (unlike the engine's scaffolded default) there is no per-app
 * `-setup` project — every spec starts from a fresh, signed-out-by-construction context.
 */
import { defineConfig, devices } from '@playwright/test';
import { qa } from './support/qa';

const recording = !qa.warmup;

function appProject(app: string) {
  return {
    name: app,
    testDir: `./specs/${app}`,
    use: { ...devices['Desktop Chrome'], baseURL: qa.baseURL(app) },
  };
}

export default defineConfig({
  outputDir: qa.artifactsDir,
  fullyParallel: false,
  workers: Number(process.env.QA_WORKERS ?? 1),
  retries: recording ? 1 : 0,
  // The warm-up pass absorbs first-hit compilation of dev servers, so it gets far longer limits.
  timeout: recording ? 120_000 : 300_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 720 },
    video: recording ? { mode: 'on', size: { width: 1280, height: 720 } } : 'off',
    trace: recording ? 'retain-on-failure' : 'off',
    screenshot: recording ? 'only-on-failure' : 'off',
    actionTimeout: 20_000,
    navigationTimeout: recording ? 60_000 : 180_000,
    launchOptions: { slowMo: qa.slowMo },
  },
  projects: Object.keys(qa.apps).map(appProject),
});
