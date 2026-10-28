import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import { PrivacyPolicyPage } from '../PrivacyPolicyPage';

function renderPage(language: 'en' | 'ar', search = '') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PrivacyPolicyPage search={search} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('PrivacyPolicyPage', () => {
  it('renders the title as the page heading, then the footer', () => {
    renderPage('en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('covers the hosted web portal and the iPhone and Android apps, not any retired local app', () => {
    renderPage('en');
    const intro = document.querySelector('.privacy-policy-intro')?.textContent ?? '';
    expect(intro).toContain('iPhone');
    expect(intro).toContain('Android');
    // MUT-150 review: the website is in scope, since the policy describes what it sends
    expect(intro).toContain("MTB3A's website");
    expect(intro).not.toMatch(/\bMac\b|\bWindows\b/);
  });

  it('says the mobile apps use an account and store data on a server, and names the processor', () => {
    renderPage('en');
    expect(screen.getByRole('heading', { level: 2, name: /iPhone and Android/ })).toBeInTheDocument();
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).toMatch(/account/i);
    expect(text).toContain('Google Cloud');
  });

  it('tells people how to close their account, and what is deleted, anonymised and kept (MUT-333, MUT-382)', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /Deleting your account/ });
    const section = heading.parentElement?.textContent ?? '';
    expect(section).toContain('Close my account');
    expect(section).toMatch(/under You › Account/);
    expect(section).toMatch(/on the Account tab/);
    expect(section).toMatch(/For 30 days you can sign in and keep your account/);
    expect(section).toMatch(/the records you added stay, without your name/);
    expect(section).toMatch(/a random internal ID, never your name or email/);
    expect(section).toMatch(/invoices for what you paid/);
    expect(section).toMatch(/before version 0\.1\.13/);
    // Closing is self-service now, and uninstalling never promised to clear the Keychain (MUT-382 #1, #4)
    expect(section).not.toMatch(/email info@/);
    expect(section).not.toMatch(/uninstalling/i);
  });

  it('says what the hosted-account request form collects, that Netlify receives it, and what it is for (MUT-186)', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /ask for an account/ });
    const section = heading.parentElement?.textContent ?? '';
    expect(section).toContain('Netlify');
    expect(section).toMatch(/only to reply with an offer/);
    expect(section).toContain('info@mtb3a.com');
    // The whole truth: the spam filter, the technical details, and how long requests are kept (qa-reconcile F2)
    expect(section).toContain('Akismet');
    expect(section).toMatch(/IP address/);
    expect(section).toMatch(/within 12 months/);
  });

  it('names Netlify among the processors and makes the request form an explicit exception (MUT-186)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    expect(body(/Who else handles your data/)).toContain('Netlify');
    expect(body(/The short version/)).toMatch(/request form/);
    expect(body(/What reaches the network/)).toMatch(/request form/);
  });

  it('explains the anonymous usage counts right after "No ads, no tracking" (MUT-154, ADR-090)', () => {
    renderPage('en');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Anonymous usage counts')).toBe(headings.indexOf('No ads, no tracking') + 1);
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const usage = body(/Anonymous usage counts/);
    expect(usage).toMatch(/PostHog, hosted in the EU/);
    expect(usage).toMatch(/without cookies/);
    expect(usage).toMatch(/your location/);
    expect(body(/Who else handles your data/)).toContain('PostHog');
    expect(body(/What reaches the network/)).toMatch(/visit counts .* to PostHog/);
    expect(body(/The short version/)).not.toMatch(/The one thing our website can send us/);
  });

  it('says the servers, the portal and the phone apps send error reports, what they hold, and that Sentry in the EU keeps them (MUT-148, MUT-149, MUT-151, ADR-091)', () => {
    renderPage('en');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Error reports')).toBe(headings.indexOf('Anonymous usage counts') + 1);
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const reports = body(/Error reports/);
    expect(reports).toMatch(/Before a report is sent, we remove amounts, names, notes, contact details, request contents, your IP address, and anything you type/);
    expect(reports).toMatch(/When the iPhone or Android app itself crashes, Sentry's own scrubbing removes them instead/);
    expect(reports).toMatch(/share extension, widgets and Siri shortcuts/);
    expect(reports).toMatch(/Our servers send a report when a request fails on our side/);
    expect(reports).toMatch(/The iPhone and Android apps send a report when the app crashes or hits an error it can't recover from/);
    expect(reports).toMatch(/They never attach screenshots or what's on your screen/);
    expect(reports).toMatch(/the hosted portal sends one when a page crashes in your browser/);
    // MUT-150 (eng D8): what the website really sends. MUT-382: the retired free apps are no longer named.
    expect(reports).toMatch(/Our website sends a report when one of its pages crashes or hits an error/);
    expect(reports).toMatch(/The website's reports include no account at all\./);
    expect(reports).not.toMatch(/free web app/);
    expect(reports).not.toMatch(/fails to load/);
    const noTracking = body(/No ads, no tracking/);
    expect(noTracking).not.toMatch(/crash reporting/);
    expect(noTracking).toMatch(/Our website, our servers, the hosted portal, and the iPhone and Android apps send error reports when something breaks/);
    expect(noTracking).not.toMatch(/free apps/);
    // MUT-382 #7: our log lines hold no IP; Google Cloud's request record holds the connecting address
    expect(noTracking).toMatch(/Our own log lines never include your IP address/);
    expect(noTracking).toMatch(/usually Cloudflare's rather than yours/);
    expect(body(/Who else handles your data/)).toMatch(/Sentry, hosted in the EU, receives the error reports/);
    expect(body(/What reaches the network/)).toMatch(/The mobile apps connect to MTB3A's servers, to Sentry for error reports/);
    expect(body(/What reaches the network/)).toMatch(/The hosted portal also sends the error reports described under "Error reports" to Sentry/);
    // One sentence for what the website sends, not two "also"s (review D2)
    expect(body(/What reaches the network/)).toMatch(/The website also sends the error reports described under "Error reports" to Sentry and the anonymous visit counts described under "Anonymous usage counts" to PostHog\./);
    // MUT-151's phone and MUT-155's PostHog sentences stay (regression contract)
    expect(body(/What reaches the network/)).toMatch(/hosted portal connects to MTB3A's servers and, if you turned on anonymous usage, to PostHog/);
  });

  it('says the same about error reports in Arabic', () => {
    renderPage('ar');
    const reports = screen.getByRole('heading', { level: 2, name: 'تقارير الأعطال' }).parentElement?.textContent ?? '';
    expect(reports).toContain('ترسل خوادمنا تقريرًا عندما يفشل طلب بسبب خلل من جهتنا');
    expect(reports).toContain('ويرسل تطبيقا iPhone وAndroid تقريرًا عندما يتعطّل التطبيق');
    expect(reports).toContain('Sentry');
    const noTracking = screen.getByRole('heading', { level: 2, name: 'لا إعلانات، لا تتبّع' }).parentElement?.textContent ?? '';
    expect(noTracking).not.toContain('أو تقارير الأعطال أو');
    expect(noTracking).toContain('يرسل موقعنا وخوادمنا والبوابة المستضافة وتطبيقا iPhone وAndroid تقارير أعطال عند حدوث خلل');
    expect(reports).toContain('يرسل موقعنا تقريرًا عندما تتعطّل إحدى صفحاته أو تواجه خطأً');
    expect(reports).toContain('ولا تتضمن تقارير الموقع أي حساب على الإطلاق.');
    expect(reports).not.toContain('تطبيق الويب المجاني');
    const network = screen.getByRole('heading', { level: 2, name: 'ما يصل إلى الشبكة' }).parentElement?.textContent ?? '';
    expect(network).toContain('ويرسل الموقع أيضًا تقارير الأعطال الموضّحة في قسم «تقارير الأعطال» إلى Sentry، وإحصاءات الزيارات المجهولة الموضّحة في قسم «إحصاءات استخدام مجهولة» إلى PostHog.');
    expect(reports).toContain('وترسل البوابة المستضافة تقريرًا عندما تتعطّل صفحة في متصفحك');
  });

  it('says what the portal counts, where it is turned off, and that it reaches PostHog only if turned on (MUT-155)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const usage = body(/Anonymous usage counts/);
    expect(usage).toMatch(/The hosted portal asks you once/);
    expect(usage).toMatch(/turn it off from the account menu/);
    // The portal sentence sits before the closing paragraph
    expect(usage.indexOf('The hosted portal asks you once')).toBeLessThan(usage.indexOf('These counts are used only'));
    expect(body(/What reaches the network/)).toMatch(/hosted portal connects to MTB3A's servers and, if you turned on anonymous usage, to PostHog/);
  });

  it('says what the phone apps count, where they are turned off, and that they reach PostHog only if turned on (MUT-157)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const usage = body(/Anonymous usage counts/);
    expect(usage).toMatch(/The iPhone and Android apps ask you once/);
    expect(usage).toMatch(/If you turn it off in Settings/);
    expect(usage.indexOf('The iPhone and Android apps ask you once')).toBeLessThan(usage.indexOf('These counts are used only'));
    const network = body(/What reaches the network/);
    expect(network).toMatch(/The mobile apps connect to MTB3A's servers, to Sentry for error reports, to the private storage that holds your receipts, and, if you turned on anonymous usage, to PostHog/);
    expect(network).not.toMatch(/The mobile apps connect only to/);
  });

  it('says the same in Arabic', () => {
    renderPage('ar');
    expect(screen.getByRole('heading', { level: 2, name: 'إحصاءات استخدام مجهولة' }).parentElement?.textContent).toContain('يسألك تطبيقا iPhone وAndroid مرة واحدة');
    expect(screen.getByRole('heading', { level: 2, name: 'إحصاءات استخدام مجهولة' }).parentElement?.textContent).toContain('تسألك البوابة المستضافة مرة واحدة');
    const usage = screen.getByRole('heading', { level: 2, name: 'إحصاءات استخدام مجهولة' }).parentElement?.textContent ?? '';
    expect(usage).toContain('PostHog');
    expect(usage).toContain('دون ملفات تعريف ارتباط');
    expect(screen.getByRole('heading', { level: 2, name: 'لا إعلانات، لا تتبّع' })).toBeInTheDocument();
  });

  it('says receipts are read on our own servers, by no outside company or language model, and the read text is not kept (MUT-441, AC9)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const entered = body(/What you enter/);
    expect(entered).toMatch(/Receipts you upload may be read automatically on MTB3A's own servers, to suggest the amount, date, currency and vendor/);
    expect(entered).toMatch(/no outside AI or OCR company ever sees your receipts, and no AI language model reads them/);
    expect(entered).toMatch(/We don't keep the text read from a receipt, only the suggested fields, and you review them before you save the expense/);
    expect(body(/Who else handles your data/)).toMatch(/our own software does it on those servers, so no other company reads it/);
  });

  it('says the same about reading receipts in Arabic (MUT-441, AC9)', () => {
    renderPage('ar');
    const body = (name: string) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const entered = body('ما الذي تُدخله');
    expect(entered).toContain('وقد تُقرأ الإيصالات التي ترفعها آليًا على خوادم متابعة الخاصة');
    expect(entered).toContain('لا تطّلع على إيصالاتك أي شركة خارجية للذكاء الاصطناعي أو لقراءة النصوص');
    expect(entered).toContain('ولا نحتفظ بالنص المقروء من الإيصال، بل بالحقول المقترحة فقط');
    expect(body('من يتعامل مع بياناتك أيضًا')).toContain('يقرؤه برنامجنا الخاص على تلك الخوادم');
  });

  it('gives MTB3A’s own contact address, and never the old Malafat one (MUT-382, B2)', () => {
    renderPage('en');
    expect(document.querySelector('main')?.textContent).toContain('info@mtb3a.com');
    expect(document.querySelector('main')?.textContent).not.toContain('info@malafat.app');
  });

  it('states where the records, backups and logs live, how they are encrypted, and the processors it was missing (MUT-382)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const hosted = body(/Where your records live/);
    expect(hosted).toMatch(/our daily backups stay there too/);
    expect(hosted).toMatch(/Google Cloud encrypts your records, receipts and backups/);
    expect(hosted).toMatch(/kept by Google Cloud for 30 days, and may be stored outside the me-west1 region/);
    expect(hosted).toMatch(/can technically reach your data/);
    expect(hosted).not.toMatch(/Our team opens your records only/);
    const sharing = body(/Who else handles your data/);
    expect(sharing).toContain('Stripe');
    expect(sharing).toMatch(/never reach our servers/);
    expect(sharing).not.toContain('{MAILBOX_PROVIDER}');
    expect(body(/Emails we send/)).toMatch(/a passkey is added/);
    expect(body(/Emails we send/)).toMatch(/the day it will be deleted/);
    expect(body(/Anonymous usage counts/)).toMatch(/the page you came from, any campaign tags/);
  });

  it('renders right to left in Arabic with no raw translation keys', () => {
    renderPage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('سياسة الخصوصية');
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });

  it.each([
    ['en', 'MTB3A — Privacy Policy'],
    ['ar', 'متابعة — سياسة الخصوصية'],
  ] as const)('names the tab in the active language (%s, MUT-77)', (language, title) => {
    renderPage(language);
    expect(document.title).toBe(title);
  });

  it('says where hosted records live, how they are backed up and processed, and when they are deleted (MUT-324)', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /Where your records live/ });
    const section = heading.parentElement?.textContent ?? '';
    for (const fact of ['me-west1', '14 days', 'Sentry', 'PostHog', 'only if you agree', '30 days', 'terms of service']) {
      expect(section).toContain(fact);
    }
  });

  it('links the terms of service from the footer (MUT-324)', () => {
    renderPage('en');
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });
});

/** MUT-356: a link from the phone or the portal names its language (`?lang`), as /terms does. */
describe('PrivacyPolicyPage ?lang', () => {
  /** The element that carries the text's own language and direction. */
  const textOf = (title: string) => screen.getByRole('heading', { level: 1, name: title }).parentElement;

  it('?lang=en shows the English policy on an Arabic site, left to right, and changes nothing stored', () => {
    renderPage('ar', '?lang=en');
    expect(textOf('Privacy Policy')).toHaveAttribute('lang', 'en');
    expect(textOf('Privacy Policy')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { level: 2, name: 'Anonymous usage counts' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('mutaba3a-language')).toBe('ar');
  });

  it('?lang=ar shows the Arabic policy on an English site, right to left', () => {
    renderPage('en', '?lang=ar');
    expect(textOf('سياسة الخصوصية')).toHaveAttribute('lang', 'ar');
    expect(textOf('سياسة الخصوصية')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 2, name: 'إحصاءات استخدام مجهولة' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
    expect(localStorage.getItem('mutaba3a-language')).toBe('en');
  });

  it('an unknown ?lang falls back to the page language', () => {
    renderPage('ar', '?lang=fr');
    expect(textOf('سياسة الخصوصية')).not.toHaveAttribute('lang');
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });
});

/**
 * MUT-369 (ADR-159 §9): the policy names what self-service signup adds. A draft until Basel approves the wording
 * (before-release.md); these tests pin what the draft must keep saying.
 */
describe('PrivacyPolicyPage self-service signup (MUT-369)', () => {
  const sectionOf = (name: string | RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';

  it('adds "When you create an account" and "Emails we send" right after where records live', () => {
    renderPage('en');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const records = headings.indexOf('Where your records live');
    expect(headings.slice(records + 1, records + 3)).toEqual(['When you create an account', 'Emails we send']);
  });

  it('says what Turnstile receives and never receives, and that the domain lookups send only the domain (DNS, RDAP)', () => {
    renderPage('en');
    const create = sectionOf('When you create an account');
    expect(create).toContain('Cloudflare Turnstile');
    expect(create).toMatch(/receives your IP address and details about your browser and device, and never what you type/);
    expect(create).toContain('public DNS records');
    expect(create).toContain('RDAP');
    expect(create).toMatch(/Only the domain name is sent in these lookups, never the rest of your address/);
    expect(create).toMatch(/reviewed by our team before the account opens/);
    expect(create).toMatch(/24 hours/);
  });

  it('names Resend, where it sends from and where its records sit, and that mail carries no amounts or tracking', () => {
    renderPage('en');
    const email = sectionOf('Emails we send');
    expect(email).toContain('Resend');
    expect(email).toContain('EU (Ireland)');
    expect(email).toContain('in the United States, under its data processing agreement');
    expect(email).toMatch(/never include amounts or your records/);
    expect(email).toMatch(/don't track whether you open them or click their links/);
    expect(email).toMatch(/bounces permanently or you mark it as spam/);
  });

  it('lists Cloudflare and Resend among those who handle data, and the doors question among what reaches the network', () => {
    renderPage('en');
    expect(sectionOf(/Who else handles your data/)).toMatch(/Cloudflare carries the connections .* Resend sends our emails/);
    const network = sectionOf(/What reaches the network/);
    expect(network).toMatch(/asks our servers whether sign-up is open/);
    expect(network).toMatch(/connect to Cloudflare Turnstile/);
    expect(sectionOf(/iPhone and Android: your account/)).not.toMatch(/no public sign-up/);
  });

  it("names the portal's trial-reminder notes and payments in the usage counts (MUT-418 TD-219, D9)", () => {
    renderPage('en');
    const usage = sectionOf(/Anonymous usage counts/);
    expect(usage).toMatch(/an income, an expense or a payment received, and when it shows the free trial's reminder to add a card and whether you chose to add one or not/);
  });

  it('names the product MTB3A throughout the English text (MUT-400 D4: this is the next real revision)', () => {
    renderPage('en');
    expect(document.querySelector('main')?.textContent).not.toContain('Mutaba3a');
  });

  it('says the same in Arabic', () => {
    renderPage('ar');
    const create = sectionOf('عند إنشاء حساب');
    expect(create).toContain('Cloudflare Turnstile');
    expect(create).toContain('RDAP');
    expect(create).toContain('لا يُرسَل في عمليات البحث هذه إلا اسم النطاق');
    const email = sectionOf('الرسائل التي نرسلها');
    expect(email).toContain('Resend');
    expect(email).toContain('الاتحاد الأوروبي (أيرلندا)');
    expect(email).toContain('في الولايات المتحدة');
    expect(sectionOf('من يتعامل مع بياناتك أيضًا')).toContain('Cloudflare');
    expect(sectionOf('ما يصل إلى الشبكة')).toContain('إن كان التسجيل مفتوحًا');
    expect(sectionOf('إحصاءات استخدام مجهولة')).toContain('وعند ظهور تذكير التجربة المجانية بإضافة بطاقة');
    expect(sectionOf(/iPhone وAndroid: حسابك/)).not.toContain('لا يوجد تسجيل عام');
  });
});
