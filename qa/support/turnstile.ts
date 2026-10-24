import type { Page } from '@playwright/test';

/**
 * MUT-368 (D11): Cloudflare Turnstile without Cloudflare. The page's request for the widget script is answered with a
 * stand-in that behaves like Cloudflare's published test site keys: `pass` like the always-pass key (a token shortly
 * after render, and again after each reset), `fail` like the always-fail key (the error callback, no token). It
 * mounts its box as an iframe from challenges.cloudflare.com, also answered here, so the portal's CSP is exercised
 * for both script-src and frame-src, exactly as production loads the real widget. QA never contacts Cloudflare.
 */

export type TurnstileMode = 'pass' | 'fail';

/** Cloudflare's dummy token shape; the QA server's always-pass test secret accepts any non-empty token. */
const STAND_IN = (mode: TurnstileMode) => `(() => {
  const mode = ${JSON.stringify(mode)};
  let n = 0;
  const widgets = {};
  const settle = (id) => setTimeout(() => {
    const w = widgets[id];
    if (!w) return;
    if (mode === 'pass') { w.frame.src = 'https://challenges.cloudflare.com/qa-widget?state=pass&lang=' + encodeURIComponent(w.options.language); w.options.callback('XXXX.DUMMY.TOKEN.XXXX.' + (++n)); }
    else { w.frame.src = 'https://challenges.cloudflare.com/qa-widget?state=fail&lang=' + encodeURIComponent(w.options.language); w.options['error-callback']('600010'); }
  }, 600);
  window.turnstile = {
    render(el, options) {
      const id = 'qa-' + (++n);
      const frame = document.createElement('iframe');
      frame.title = 'Turnstile (QA stand-in)';
      frame.src = 'https://challenges.cloudflare.com/qa-widget?state=checking&lang=' + encodeURIComponent(options.language);
      frame.style.border = '0';
      frame.style.width = '100%';
      frame.style.height = '65px';
      el.appendChild(frame);
      widgets[id] = { el, options, frame };
      settle(id);
      return id;
    },
    reset(id) { settle(id); },
    remove(id) { const w = widgets[id]; if (w) { w.frame.remove(); delete widgets[id]; } },
  };
  const onload = new URL(document.currentScript.src).searchParams.get('onload');
  if (onload && typeof window[onload] === 'function') window[onload]();
})();`;

const LABELS: Record<string, Record<string, string>> = {
  checking: { en: 'Verifying…', ar: 'جارٍ التحقق…' },
  pass: { en: '✓ Success (QA stand-in)', ar: '✓ تم (بديل الاختبار)' },
  fail: { en: '✗ Failed (QA stand-in)', ar: '✗ فشل (بديل الاختبار)' },
};

/** Answer the widget's script and frame for this page. Call before the page opens /signup or /recover. */
export async function stubTurnstile(page: Page, mode: TurnstileMode = 'pass'): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STAND_IN(mode) }),
  );
  await page.route('https://challenges.cloudflare.com/qa-widget**', (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state') ?? 'checking';
    const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const body = `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><body style="margin:0;font:14px system-ui;display:flex;align-items:center;height:63px;padding:0 12px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box">${LABELS[state]![lang]}</body></html>`;
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
}
