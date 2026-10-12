/**
 * release-qa Playwright support — scaffolded by `release-qa init`; owned by this project.
 *
 * Every spec imports `test` / `expect` from here instead of '@playwright/test':
 *   - `persona` option  → reuse the storageState saved by the app's auth.setup.ts
 *   - `step(title, fn)` → a test.step that also shows `title` as an on-screen caption,
 *                          so the recorded video explains itself; the report seeks to it
 *   - clicks are drawn as a red ripple in the video
 *   - tag each test with its feature id:  test('…', { tag: '@web.matters.create' }, …)
 */
import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

export interface Persona {
  email: string;
  password?: string;
  [key: string]: unknown;
}
interface AppContext {
  baseURL: string;
  personas: Record<string, Persona>;
}
interface QaContext {
  apps: Record<string, AppContext>;
  warmup: boolean;
  slowMo: number;
  artifactsDir: string;
  stateDir: string;
  /** When set, every test sends a distinct client address in this header (see qa.config.mjs). */
  clientIpHeader?: string | null;
}

function loadContext(): QaContext {
  if (process.env.QA_CONTEXT) return JSON.parse(process.env.QA_CONTEXT) as QaContext;
  // Running Playwright directly (IDE, `npx playwright test`): fall back to qa.config.mjs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cfg = require('../qa.config.mjs').default;
  const apps: Record<string, AppContext> = {};
  for (const [key, app] of Object.entries<any>(cfg.apps)) {
    apps[key] = { baseURL: app.attachURL ?? app.baseURL, personas: app.personas ?? {} };
  }
  const qaDir = path.resolve(__dirname, '..');
  return {
    apps,
    warmup: false,
    slowMo: 0,
    artifactsDir: path.join(qaDir, '.state', 'direct'),
    stateDir: path.join(qaDir, '.state'),
    clientIpHeader: cfg.playwright?.clientIpHeader ?? null,
  };
}

const ctx = loadContext();

export const qa = {
  ...ctx,
  app(key: string): AppContext {
    const a = ctx.apps[key];
    if (!a) throw new Error(`release-qa: unknown app "${key}" (known: ${Object.keys(ctx.apps).join(', ')})`);
    return a;
  },
  baseURL(key: string): string {
    return qa.app(key).baseURL;
  },
  persona(app: string, name: string): Persona {
    const p = qa.app(app).personas[name];
    if (!p) throw new Error(`release-qa: app "${app}" has no persona "${name}" in qa.config.mjs`);
    return p;
  },
};

/** Where an app's auth.setup.ts saves, and specs load, a persona's signed-in session. */
export function authFile(app: string, persona: string): string {
  const dir = path.join(ctx.stateDir, 'auth');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${app}-${persona}.json`);
}

function sessionFile(app: string, persona: string): string {
  return authFile(app, persona).replace(/\.json$/, '.session.json');
}

/**
 * Save everything a signed-in browser holds: cookies + localStorage + IndexedDB (Playwright's
 * storageState) and sessionStorage, which storageState leaves out. Apps keep per-tab state there
 * (an "unlocked this session" flag, a wizard step) that a fresh test would otherwise lose.
 * Call it at the end of each persona's sign-in in <app>/auth.setup.ts.
 */
export async function saveSignedInState(page: Page, app: string, persona: string): Promise<void> {
  await page.context().storageState({ path: authFile(app, persona), indexedDB: true });
  const entries = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  fs.writeFileSync(sessionFile(app, persona), JSON.stringify({ origin: new URL(page.url()).origin, entries }));
}

async function restoreSessionStorage(context: BrowserContext, app: string, persona: string) {
  const file = sessionFile(app, persona);
  if (!fs.existsSync(file)) return;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { origin: string; entries: Record<string, string> };
  await context.addInitScript((s: { origin: string; entries: Record<string, string> }) => {
    if (location.origin !== s.origin) return;
    for (const [k, v] of Object.entries(s.entries)) {
      if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v);
    }
  }, saved);
}

/** A short unique suffix so data created by one run never collides with another. */
export function uniq(prefix: string): string {
  return `${prefix} ${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
}

const OVERLAY = `(() => {
  if (window.__qaOverlay) return;
  window.__qaOverlay = true;
  const KEY = '__qa_caption';
  const ensure = () => {
    if (!document.body) return null;
    let el = document.getElementById('__qa_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__qa_caption';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:84vw;padding:7px 16px;border-radius:999px;background:rgba(17,17,16,.84);color:#fff;font:600 14px/1.35 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.28);direction:ltr;unicode-bidi:isolate;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .2s';
      document.body.appendChild(el);
    }
    return el;
  };
  window.__qaCaption = (text) => {
    try { sessionStorage.setItem(KEY, text || ''); } catch (e) {}
    const el = ensure();
    if (el) { el.textContent = text || ''; el.style.opacity = text ? '1' : '0'; }
  };
  const restore = () => { let t = ''; try { t = sessionStorage.getItem(KEY) || ''; } catch (e) {} if (t) window.__qaCaption(t); };
  document.addEventListener('DOMContentLoaded', restore);
  window.addEventListener('load', () => { restore(); setTimeout(restore, 800); });
  document.addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:30px;height:30px;border-radius:50%;border:3px solid #ff3b30;background:rgba(255,59,48,.22);transform:translate(-50%,-50%) scale(.6);transition:transform .5s ease-out,opacity .5s ease-out;left:' + e.clientX + 'px;top:' + e.clientY + 'px';
    document.documentElement.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'translate(-50%,-50%) scale(1.7)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 650);
  }, true);
})();`;

async function setCaption(page: Page, text: string) {
  await page.evaluate((t) => (window as unknown as { __qaCaption?: (s: string) => void }).__qaCaption?.(t), text).catch(() => {});
}

type Step = <T>(title: string, body: () => Promise<T>) => Promise<T>;

/** A private-range address unique to one test attempt, so IP-keyed rate limits see separate clients. */
function clientIpFor(testId: string, retry: number): string {
  let h = 2166136261;
  for (const ch of `${testId}:${retry}:${Date.now()}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${(h & 253) + 1}`;
}

export const test = base.extend<{ persona: string | null; step: Step }>({
  persona: [null, { option: true }],

  storageState: async ({ persona, storageState }, use, testInfo) => {
    const app = testInfo.project.name.replace(/-setup$/, '');
    await use(persona ? authFile(app, persona) : storageState);
  },

  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    if (!ctx.clientIpHeader) return use(extraHTTPHeaders);
    await use({ ...extraHTTPHeaders, [ctx.clientIpHeader]: clientIpFor(testInfo.testId, testInfo.retry) });
  },

  context: async ({ context, persona }, use, testInfo) => {
    await context.addInitScript(OVERLAY);
    if (persona) await restoreSessionStorage(context, testInfo.project.name.replace(/-setup$/, ''), persona);
    await use(context);
  },

  page: async ({ page }, use, testInfo) => {
    testInfo.annotations.push({ type: 'qa-video-start', description: String(Date.now()) });
    let current = '';
    page.on('load', () => {
      if (current) void setCaption(page, current);
    });
    (page as unknown as { __qaSetCurrent: (t: string) => void }).__qaSetCurrent = (t) => {
      current = t;
    };
    await use(page);
  },

  step: async ({ page }, use) => {
    await use((title, body) =>
      base.step(title, async () => {
        (page as unknown as { __qaSetCurrent: (t: string) => void }).__qaSetCurrent(title);
        await setCaption(page, title);
        return body();
      }),
    );
  },
});

export { expect };
