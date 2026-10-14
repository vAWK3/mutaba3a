/**
 * release-qa config for mini-crm (MUT-97, companion to MAL-1007).
 * Engine and docs: ~/Work/tools/release-qa (SKILL.md).
 *
 * mini-crm is a single local-first SPA: no server, no auth, no shared database.
 * Every browser context gets its own fresh IndexedDB, so there is no seed step and
 * no personas — each spec dismisses the first-run "Welcome" dialog itself
 * (support/app.ts openFreshApp), same as the e2e/ suite this catalog replaces.
 */
export default {
  name: 'mini-crm',
  title: 'Mutaba3a — mini-crm',

  apps: {
    web: {
      label: 'Web app',
      platform: 'web',
      // Mutaba3a tags releases (v0.0.N); Malafat's apps use commit-grep instead.
      release: { strategy: 'tag', pattern: 'v*' },
      watch: [
        'src/**',
        '!src/**/__tests__/**',
        '!src/**/*.test.{ts,tsx}',
        '!src/test/**',
        '!src/**/*.d.ts',
        '!src/hosted/**', // separate deploy target (MUT-34/45) — its own future qa app, not this one
        '!src/demo/**', // seed data for local dev, not a user-facing flow
      ],
      baseURL: 'http://localhost:5173',
      attachURL: 'http://localhost:5173',
      // Plain `vite` (no --mode): __BUILD_MODE__ resolves to "web", which mounts the
      // app under /app — every spec below navigates to /app/... to match.
      start: { cmd: 'npm run dev -- --port 5173 --strictPort' },
      ready: 'http://localhost:5173',
      personas: {}, // no auth — local-first, single-user
    },
    portal: {
      label: 'Hosted portal',
      platform: 'web',
      release: { strategy: 'tag', pattern: 'v*' },
      // The portal's own code, plus the shared token and font files it renders with (MUT-102)
      watch: ['src/hosted/**', 'hosted.html', 'src/styles/**', 'src/assets/fonts/**', 'src/components/malafat/**', 'src/lib/malafatSuggestions.ts', 'src/content/malafatLinks.ts', '!src/hosted/**/__tests__/**', '!src/**/*.test.{ts,tsx}'],
      // `vite --mode hosted` (MUT-43). Specs stub every /v1 call with page.route, so no API runs:
      // a 401 from /v1/me is the signed-out portal, which is all the sign-in specs need.
      baseURL: 'http://127.0.0.1:5175',
      attachURL: 'http://127.0.0.1:5175',
      start: { cmd: 'npm run dev:hosted' },
      ready: 'http://127.0.0.1:5175',
      personas: {},
    },
  },

  env: {
    // Isolated checkout so a QA run never touches your working tree or dev server.
    worktree: { path: '.claude/worktrees/qa-release', copy: [], install: 'npm ci --prefer-offline' },
    vars: {},
    up: [],
    down: [],
    check: [],
  },

  playwright: {
    cwd: '.',
    command: 'npx playwright test',
    config: 'playwright.config.ts',
    warmup: false, // Vite serves instantly — no first-hit compilation to absorb
    slowMo: 250,
  },
};
