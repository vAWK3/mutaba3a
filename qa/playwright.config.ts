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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One test project per form-factor target (`<app>@<target>`, QA-STANDARD.md rule 3) with that
 * target's viewport and only the flows it must prove. No `-setup` project (no auth, see above).
 * An app that hasn't declared formFactors yet gets the old single desktop project.
 */
function appProjects(app: string) {
  const common = {
    ...devices['Desktop Chrome'],
    baseURL: qa.baseURL(app),
    permissions: qa.permissions(app),
    ...(qa.app(app).geolocation ? { geolocation: qa.app(app).geolocation! } : {}),
  };
  const targets = qa.targets(app);
  if (!targets.length) return [{ name: app, testDir: `./specs/${app}`, use: common }];
  return targets
    .filter((t) => t.features === null || t.features.length)
    .map((t) => ({
      name: `${app}@${t.name}`,
      testDir: `./specs/${app}`,
      ...(t.features ? { grep: new RegExp(`@(${t.features.map(escape).join('|')})(?![\\w.-])`) } : {}),
      use: { ...common, ...t.use, video: recording ? { mode: 'on' as const, size: t.use.viewport } : ('off' as const) },
    }));
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
    // Camera and microphone answer with fake devices instead of a prompt (rule 1).
    launchOptions: { slowMo: qa.slowMo, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: Object.keys(qa.apps).flatMap(appProjects),
});
