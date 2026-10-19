import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import { PrivacyPolicyPage } from '../PrivacyPolicyPage';

function renderPage(language: 'en' | 'ar') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PrivacyPolicyPage />
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
    expect(intro).not.toMatch(/\bMac\b|\bWindows\b/);
  });

  it('says the mobile apps use an account and store data on a server, and names the processor', () => {
    renderPage('en');
    expect(screen.getByRole('heading', { level: 2, name: /iPhone and Android/ })).toBeInTheDocument();
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).toMatch(/account/i);
    expect(text).toContain('Google Cloud');
  });

  it('tells mobile users how to have their account and data deleted', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /Deleting your account/ });
    expect(heading.parentElement?.textContent).toContain('info@malafat.app');
  });

  it('says what the hosted-account request form collects, that Netlify receives it, and what it is for (MUT-186)', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /ask for an account/ });
    const section = heading.parentElement?.textContent ?? '';
    expect(section).toContain('Netlify');
    expect(section).toMatch(/only to reply with an offer/);
    expect(section).toContain('info@malafat.app');
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
    // The crash-reporting promise stays until Sentry ships (MUT-146 owns those words)
    expect(body(/No ads, no tracking/)).toMatch(/crash reporting/);
  });

  it('says what the portal counts, where it is turned off, and that it reaches PostHog only if turned on (MUT-155)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const usage = body(/Anonymous usage counts/);
    expect(usage).toMatch(/The hosted portal asks you once/);
    expect(usage).toMatch(/turn it off from the account menu/);
    // The portal sentence sits before the closing paragraph
    expect(usage.indexOf('The hosted portal asks you once')).toBeLessThan(usage.indexOf('These counts are used only'));
    expect(body(/What reaches the network/)).toMatch(/hosted portal connects to Mutaba3a's servers and, if you turned on anonymous usage, to PostHog/);
  });

  it('says what the phone apps count, where they are turned off, and that they reach PostHog only if turned on (MUT-157)', () => {
    renderPage('en');
    const body = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).parentElement?.textContent ?? '';
    const usage = body(/Anonymous usage counts/);
    expect(usage).toMatch(/The iPhone and Android apps ask you once/);
    expect(usage).toMatch(/If you turn it off in Settings/);
    expect(usage.indexOf('The iPhone and Android apps ask you once')).toBeLessThan(usage.indexOf('These counts are used only'));
    const network = body(/What reaches the network/);
    expect(network).toMatch(/The mobile apps connect to Mutaba3a's servers, to the private storage that holds your receipts, and, if you turned on anonymous usage, to PostHog/);
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

  it('gives a contact address', () => {
    renderPage('en');
    expect(document.querySelector('main')?.textContent).toContain('info@malafat.app');
  });

  it('renders right to left in Arabic with no raw translation keys', () => {
    renderPage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('سياسة الخصوصية');
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });

  it.each([
    ['en', 'Mutaba3a — Privacy Policy'],
    ['ar', 'متابعة — سياسة الخصوصية'],
  ] as const)('names the tab in the active language (%s, MUT-77)', (language, title) => {
    renderPage(language);
    expect(document.title).toBe(title);
  });

  it('says where hosted records live, how they are backed up and processed, and when they are deleted (MUT-324)', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /Where your records live/ });
    const section = heading.parentElement?.textContent ?? '';
    for (const fact of ['me-west1', 'Tel Aviv', '14 days', 'Sentry', 'PostHog', 'only if you agree', '30 days', 'terms of service']) {
      expect(section).toContain(fact);
    }
  });

  it('links the terms of service from the footer (MUT-324)', () => {
    renderPage('en');
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });
});
