import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPlainAddress, isUnownedDomain, TEMPLATE_IDS, type MailTemplateId, type TemplateVars } from '../email/ports.js';
import { BRAND_NAME, renderMail } from '../email/templates/index.js';
import { createResendTransport } from '../email/transports/resend.js';
import type { UserLocale } from '../repositories/ports.js';

/**
 * MUT-468: every mail in both languages, for review and for the client checks.
 *
 *   npm --prefix server run mail:preview
 *       Writes server/.mail-preview/: <id>.<locale>.html (pictures on, loaded from src/hosted/public/mail/v1 by
 *       relative path), <id>.<locale>.no-images.html, and index.html listing them. Open index.html in a browser.
 *   npm --prefix server run mail:preview -- --send <address>
 *       Sends each mail, both languages, through Resend to one inbox (Gmail, Apple Mail, Outlook checks). Needs
 *       RESEND_API_KEY, MAIL_FROM_ADDRESS and PORTAL_ORIGIN (a portal that already serves /mail/v1); WEBSITE_ORIGIN
 *       optional. Bypasses the mailer's log and caps: it is an operator tool, one address, sample values only.
 */
const LOCALES: readonly UserLocale[] = ['ar', 'en'];
const SAMPLE_LINK = 'https://app.example.com/setup#sample-token';
const SAMPLE_SIGN_IN = 'https://app.example.com/sign-in';
const SAMPLE: { [T in MailTemplateId]: TemplateVars[T] } = {
  'finish-signup': { link: SAMPLE_LINK, validHours: 24 },
  'account-exists': { signInLink: SAMPLE_SIGN_IN, recoverLink: 'https://app.example.com/recover' },
  'reset-password': { link: SAMPLE_LINK, validHours: 1 },
  'finish-setup': { link: SAMPLE_LINK, validHours: 72 },
  'password-changed': { first: false, signInLink: SAMPLE_SIGN_IN },
  'account-under-review': {},
  'account-ready': { signInLink: SAMPLE_SIGN_IN },
  'account-declined': { supportAddress: 'help@example.com' },
  'review-digest': { pending: 3, command: 'npm --prefix server run signups:review', reviewLink: 'https://app.example.com/operator/signups' },
  'trial-ending-soon': { daysLeft: 3, subscribeLink: 'https://app.example.com/?billing=true&step=subscribe' },
  'trial-ended': { subscribeLink: 'https://app.example.com/?billing=true&step=subscribe', exportLink: 'https://app.example.com/?yourData=true' },
  'trial-locking-soon': { daysLeft: 2, subscribeLink: 'https://app.example.com/?billing=true&step=subscribe', exportLink: 'https://app.example.com/?yourData=true' },
  'account-closing': { deleteOn: { year: 2026, month: 11, day: 23 }, signInLink: SAMPLE_SIGN_IN },
  'passkey-added': { passkeyName: 'iCloud Keychain', signInLink: SAMPLE_SIGN_IN },
};
const SAMPLE_RECIPIENT = 'rana@example.com';
/** Rendered with this origin, then rewritten to a relative path so the files open offline. */
const PLACEHOLDER_ORIGIN = 'https://art.invalid';
const RESEND_PAUSE_MS = 600;

const serverDir = fileURLToPath(new URL('../../', import.meta.url));
const artDir = join(serverDir, '..', 'src', 'hosted', 'public', 'mail', 'v1');

function writePreviews(outDir: string, websiteOrigin: string | undefined): string[] {
  mkdirSync(outDir, { recursive: true });
  const artPath = `${relative(outDir, artDir)}/`;
  const files: string[] = [];
  for (const id of TEMPLATE_IDS) {
    for (const locale of LOCALES) {
      const vars = SAMPLE[id] as never;
      const withArt = renderMail(id, locale, vars, { to: SAMPLE_RECIPIENT, artOrigin: PLACEHOLDER_ORIGIN, websiteOrigin });
      const noArt = renderMail(id, locale, vars, { to: SAMPLE_RECIPIENT, websiteOrigin });
      const name = `${id}.${locale}`;
      writeFileSync(join(outDir, `${name}.html`), withArt.html.split(`${PLACEHOLDER_ORIGIN}/mail/v1/`).join(artPath));
      writeFileSync(join(outDir, `${name}.no-images.html`), noArt.html);
      writeFileSync(join(outDir, `${name}.txt`), `Subject: ${withArt.subject}\n\n${withArt.text}\n`);
      files.push(name);
    }
  }
  const links = files.map((name) => `<li>${name}: <a href="${name}.html">pictures</a> · <a href="${name}.no-images.html">no pictures</a> · <a href="${name}.txt">text</a></li>`);
  writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${BRAND_NAME.en} mail preview</title><ul>${links.join('')}</ul>`);
  return files;
}

async function sendAll(to: string): Promise<number> {
  const { RESEND_API_KEY, MAIL_FROM_ADDRESS, PORTAL_ORIGIN, WEBSITE_ORIGIN } = process.env;
  if (!RESEND_API_KEY || !MAIL_FROM_ADDRESS || !PORTAL_ORIGIN) {
    console.error('[mail:preview] --send needs RESEND_API_KEY, MAIL_FROM_ADDRESS and PORTAL_ORIGIN');
    return 1;
  }
  if (!isPlainAddress(to) || isUnownedDomain(to)) {
    console.error(`[mail:preview] refusing to send to ${JSON.stringify(to)}`);
    return 1;
  }
  const transport = createResendTransport({ apiKey: RESEND_API_KEY });
  const run = Date.now();
  for (const id of TEMPLATE_IDS) {
    for (const locale of LOCALES) {
      const mail = renderMail(id, locale, SAMPLE[id] as never, { to, artOrigin: PORTAL_ORIGIN, websiteOrigin: WEBSITE_ORIGIN });
      const idempotencyKey = createHash('sha256').update(`mail-preview:${run}:${id}:${locale}`).digest('hex');
      await transport.deliver({ ...mail, to, from: `${BRAND_NAME.en} <${MAIL_FROM_ADDRESS}>`, replyTo: null, template: id, locale, idempotencyKey });
      console.log(`[mail:preview] sent ${id} (${locale})`);
      await new Promise((resolve) => setTimeout(resolve, RESEND_PAUSE_MS));
    }
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const send = argv.indexOf('--send');
  if (send >= 0) return sendAll(argv[send + 1] ?? '');
  const outDir = join(serverDir, '.mail-preview');
  const files = writePreviews(outDir, process.env.WEBSITE_ORIGIN);
  console.log(`[mail:preview] ${files.length} mails written to ${join(outDir, 'index.html')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
