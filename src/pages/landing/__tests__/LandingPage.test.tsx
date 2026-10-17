import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import type { ReleaseInfo } from '../../../hooks/useLatestRelease';
import { LandingPage } from '../LandingPage';
import { malafatUrl } from '../../../content/malafatLinks';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';

const release = vi.hoisted(() => ({
  current: {
    release: {
      version: '0.0.66',
      releaseNotesUrl: 'https://example.test/notes',
      hasMacBuild: true,
      hasWindowsBuild: true,
    } as ReleaseInfo | null,
    isLoading: false,
    error: null as string | null,
  },
}));

vi.mock('../../../hooks/useLatestRelease', () => ({
  useLatestRelease: () => release.current,
}));

// The store config, swapped per case through a getter so every reassignment is seen (as HostedOfferPage.test does)
const apps = vi.hoisted(() => ({
  links: {
    ios: { available: true, url: null as string | null },
    android: { available: false, url: null as string | null },
  },
}));

vi.mock('../../../content/download-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../content/download-config')>()),
  get MOBILE_APP_LINKS() {
    return apps.links;
  },
}));

function renderLanding(language: 'en' | 'ar') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <LandingPage />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function part(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`main [data-part="${name}"]`);
  if (!el) throw new Error(`missing part ${name}`);
  return el;
}

/**
 * Claims the landing's paid-tier sections must never make (MUT-173/174): reports or analytics the portal
 * doesn't have, a price or subscription, a sync or automation the capture doesn't do. Arabic is matched with
 * its diacritics stripped, so a fatha or shadda can't slip a word past it.
 */
const BANNED_CLAIMS_EN =
  /report|analytic|dashboard|statistic|chart|\bpric\w*|\/month|per month|subscri\w*|checkout|sign[- ]?up|[$₪€]\s?\d|\d\s?(usd|ils|eur)\b|\b(sync\w*|auto(mat\w*|-\w+)|seamless\w*|instant\w*|real[- ]?time)\b/i;
const BANNED_CLAIMS_AR = /تقرير|تقارير|تحليل|إحصا|رسوم بيانية|سعر|أسعار|اشترا?ك|زامن|تلقائ|آليا|فوري|لحظي/;
/** MUT-25's still-in-progress "shared money core": the Malafat band must not describe Mutaba3a as part of Malafat. */
const MONEY_CORE_EN = /\b(module|core|engine)\b|inside malafat|within malafat|part of malafat|built into|embedded|integrat\w* into/i;
const MONEY_CORE_AR = /داخل|ضمن|جزء من|مدمج|وحدة|نواة|محر?ك/;

/** Arabic without its harakat, shadda and tatweel. */
function bare(text: string): string {
  return text.replace(/[\u064B-\u0652\u0640]/g, '');
}

/** A part's own words, without any decorative mock (sample amounts are not prices). */
function partCopy(name: string): string {
  const section = part(name).cloneNode(true) as HTMLElement;
  section.querySelectorAll('[data-part="devices-mock"]').forEach((el) => el.remove());
  return section.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  apps.links = { ios: { available: true, url: null }, android: { available: false, url: null } };
  release.current = {
    release: {
      version: '0.0.66',
      releaseNotesUrl: 'https://example.test/notes',
      hasMacBuild: true,
      hasWindowsBuild: true,
    },
    isLoading: false,
    error: null,
  };
});

describe('LandingPage structure', () => {
  it('renders the nine parts in order, then the footer', () => {
    renderLanding('en');
    const parts = Array.from(document.querySelectorAll('main > [data-part]')).map(
      (el) => el.getAttribute('data-part')
    );
    expect(parts).toEqual([
      'hero',
      'chapter-clients',
      'chapter-payment',
      'chapter-businesses',
      'privacy',
      'get-it',
      'phone',
      'malafat',
      'faq',
    ]);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('leads with the two-beat headline', () => {
    renderLanding('en');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Track your finances, securely.');
  });

  it('gives each chapter its own heading', () => {
    renderLanding('en');
    expect(within(part('chapter-clients')).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Every client on one page.'
    );
    expect(within(part('chapter-payment')).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Paid? Two taps.'
    );
    expect(
      within(part('chapter-businesses')).getByRole('heading', { level: 2 })
    ).toHaveTextContent('Every business you run.');
  });
});

describe('LandingPage honesty', () => {
  // Scoped to <main>: the footer's "Buy Me a Coffee" is a donation brand, not a price.
  it('makes no price or platform claim the product cannot keep (EN)', () => {
    renderLanding('en');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/\bBuy\b/);
    expect(text).not.toContain('$49');
    expect(text).not.toMatch(/Universal/i);
    expect(text).not.toMatch(/Intel/i);
  });

  it('makes no price claim in Arabic either', () => {
    renderLanding('ar');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/شراء|اشترِ|اشتر /);
    expect(text).not.toContain('49');
  });

  it('says the app is free during early access', () => {
    renderLanding('en');
    expect(part('get-it')).toHaveTextContent('Free during early access');
  });

  it('says so when the latest release has no Windows installer, instead of linking to it', () => {
    release.current = {
      ...release.current,
      release: { ...release.current.release!, hasWindowsBuild: false },
    };
    renderLanding('en');
    const getIt = part('get-it');
    expect(within(getIt).queryByRole('link', { name: /windows/i })).toBeNull();
    expect(getIt).toHaveTextContent(/Windows installer isn't in this release/i);
  });

  it('links to the Windows installer when the release has one', () => {
    renderLanding('en');
    const link = within(part('get-it')).getByRole('link', { name: /Download for Windows/i });
    expect(link).toHaveAttribute('href', '/download/windows');
  });

  it('labels the Mac download for Apple Silicon', () => {
    renderLanding('en');
    expect(part('get-it')).toHaveTextContent('Apple Silicon');
  });

  it('still offers downloads while the release is unknown', () => {
    release.current = { release: null, isLoading: false, error: 'offline' };
    renderLanding('en');
    expect(within(part('get-it')).getByRole('link', { name: /Download for Mac/i })).toHaveAttribute(
      'href',
      '/download/mac'
    );
  });
});

describe('LandingPage Get it, free vs paid (MUT-172)', () => {
  // No price, no checkout, no signup, no platform the phone app can't yet be installed on
  const BANNED_EN = /\bprice\b|\/month|checkout|sign ?up|\$\d|android|\bios\b/i;
  const BANNED_AR = /سعر|اشترك|إنشاء حساب/;

  it('says the hosted account and phone app come with a paid plan, with one link to /hosted', () => {
    renderLanding('en');
    const paid = part('get-it-paid');
    expect(paid).toHaveTextContent('Unlike the apps above');
    expect(paid).toHaveTextContent('paid plan');
    const links = within(paid).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('See hosted accounts');
    expect(links[0]).toHaveAttribute('href', '/hosted');
    expect(links[0]).not.toHaveAttribute('target');
    expect(paid.textContent).not.toMatch(BANNED_EN);
  });

  it('leaves the free line in place above it (A1)', () => {
    renderLanding('en');
    expect(part('get-it')).toHaveTextContent('Free during early access');
    expect(part('get-it').textContent).not.toMatch(/stay free/i);
  });

  it('reads the same in Arabic', () => {
    renderLanding('ar');
    const paid = part('get-it-paid');
    expect(paid).toHaveTextContent('خطة مدفوعة');
    expect(within(paid).getByRole('link', { name: 'اطّلع على الحسابات المستضافة' })).toHaveAttribute('href', '/hosted');
    expect(paid.textContent).not.toMatch(BANNED_AR);
  });
});

describe('LandingPage phone and portal (MUT-173)', () => {
  const stores = () => within(part('phone')).getByRole('list', { name: 'Phone apps' });

  it('says the phone logs and the hosted account shows, with one link to /hosted', () => {
    renderLanding('en');
    const section = part('phone');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Log it on your phone. See it all in your hosted account.',
    );
    expect(section).toHaveTextContent('The phone app is for logging');
    expect(section).toHaveTextContent('portal');
    const link = within(section).getByRole('link', { name: 'See hosted accounts' });
    expect(link).toHaveAttribute('href', '/hosted');
    expect(link).not.toHaveAttribute('target');
    expect(within(section).getAllByRole('link')).toHaveLength(1);
  });

  it('links a store once its URL is configured, in a new tab', () => {
    apps.links = {
      ios: { available: true, url: 'https://apps.apple.com/app/id1' },
      android: { available: true, url: 'https://play.google.com/store/apps/details?id=com.barmajiyat.mutaba3a' },
    };
    renderLanding('en');
    const ios = within(stores()).getByRole('link', { name: 'iPhone, on the App Store' });
    // The landing's campaign rides along, so the store consoles can attribute installs (MUT-154)
    expect(ios).toHaveAttribute('href', 'https://apps.apple.com/app/id1?ct=mutaba3a-landing');
    expect(ios).toHaveAttribute('target', '_blank');
    expect(ios.getAttribute('rel')).toContain('noopener');
    expect(within(stores()).getByRole('link', { name: 'Android, on Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.barmajiyat.mutaba3a&referrer=utm_source%3Dmutaba3a%26utm_medium%3Dweb%26utm_campaign%3Dmutaba3a-landing',
    );
    expect(within(stores()).getAllByRole('link')).toHaveLength(2);
    expect(stores().textContent).not.toMatch(/coming soon/);
  });

  it('names an available app without a link while no store URL is set, never a dead link', () => {
    renderLanding('en');
    const list = stores();
    expect(list).toHaveTextContent('iPhone with your hosted account');
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    expect(list.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it('never links a placeholder that is not an https URL, nor an app that is not available', () => {
    apps.links = { ios: { available: true, url: 'TBD' }, android: { available: false, url: 'https://play.google.com/x' } };
    renderLanding('en');
    const list = stores();
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    expect(list).toHaveTextContent('iPhone with your hosted account');
    expect(list).toHaveTextContent('Android coming soon');
  });

  it('says a platform is coming soon while it is not available, and drops the note once it is', () => {
    renderLanding('en');
    expect(stores()).toHaveTextContent('Android coming soon');
    cleanup();
    apps.links = { ios: { available: true, url: null }, android: { available: true, url: 'https://play.google.com/x' } };
    renderLanding('en');
    expect(stores().textContent).not.toMatch(/coming soon/);
    expect(within(stores()).getByRole('link', { name: 'Android, on Google Play' })).toBeInTheDocument();
  });

  it('reads the same in Arabic', () => {
    renderLanding('ar');
    const section = part('phone');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('سجّل من هاتفك');
    expect(within(section).getByRole('link', { name: 'اطّلع على الحسابات المستضافة' })).toHaveAttribute('href', '/hosted');
    expect(within(section).getByRole('list', { name: 'تطبيقات الهاتف' })).toHaveTextContent('Android قريبًا');
  });

  it('claims no reports, analytics, price or automation, in either language', () => {
    renderLanding('en');
    expect(partCopy('phone')).not.toMatch(BANNED_CLAIMS_EN);
    cleanup();
    renderLanding('ar');
    expect(bare(partCopy('phone'))).not.toMatch(BANNED_CLAIMS_AR);
  });
});

describe('LandingPage FAQ', () => {
  it('asks exactly six questions, each one opening its answer', () => {
    renderLanding('en');
    const questions = within(part('faq')).getAllByRole('button');
    expect(questions).toHaveLength(6);

    const first = questions[0];
    expect(first).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const answer = document.getElementById(first.getAttribute('aria-controls')!);
    expect(answer).not.toHaveAttribute('hidden');
  });

  it('warns about data loss exactly once, inside the backup answer', () => {
    renderLanding('en');
    const warning = /export a backup first/gi;
    expect((document.body.textContent ?? '').match(warning)).toHaveLength(1);
    expect(part('faq').textContent).toMatch(warning);
  });

  it('names every supported currency in the currency answer', () => {
    renderLanding('en');
    const faq = part('faq').textContent ?? '';
    expect(faq).toContain('US dollars');
    expect(faq).toContain('shekels');
    expect(faq).toContain('euros');
  });
});

describe('LandingPage language', () => {
  it('renders right to left in Arabic', () => {
    renderLanding('ar');
    expect(document.documentElement.dir).toBe('rtl');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('تابع مالك، بأمان.');
  });

  it.each(['en', 'ar'] as const)('shows no raw translation keys (%s)', (language) => {
    renderLanding(language);
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });

  it("uses the app's own Record payment label in the payment chapter", () => {
    renderLanding('en');
    expect(part('chapter-payment')).toHaveTextContent('Record Payment');
  });
});

describe('LandingPage header button (MUT-77)', () => {
  beforeEach(() => installFakeIntersectionObserver());
  afterEach(() => vi.unstubAllGlobals());

  const heroCta = () => document.querySelector<HTMLAnchorElement>('.hero-cta-primary')!;
  const headerCta = () => document.querySelector<HTMLAnchorElement>('[data-part="header-cta"]')!;

  it('keeps it hidden until it is known that the hero button has scrolled away', () => {
    renderLanding('en');
    expect(headerCta()).toHaveAttribute('data-visible', 'false');

    FakeIntersectionObserver.reportFor(heroCta(), true);
    expect(headerCta()).toHaveAttribute('data-visible', 'false');

    FakeIntersectionObserver.reportFor(heroCta(), false);
    expect(headerCta()).toHaveAttribute('data-visible', 'true');

    FakeIntersectionObserver.reportFor(heroCta(), true);
    expect(headerCta()).toHaveAttribute('data-visible', 'false');
  });

  it('watches the hero button below the sticky bar, so it counts as gone once it slides under the bar', () => {
    renderLanding('en');
    const observer = FakeIntersectionObserver.instances.find((o) => o.observed.includes(heroCta()))!;
    expect(observer.options?.rootMargin).toMatch(/^-\d+px 0px 0px 0px$/);
  });

  it('stays hidden in a browser with no IntersectionObserver, where the hero button is the way in', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderLanding('en');
    expect(headerCta()).toHaveAttribute('data-visible', 'false');
  });
});

describe('LandingPage title (MUT-77)', () => {
  it('follows the active language', () => {
    renderLanding('en');
    expect(document.title).toBe('Mutaba3a — Track your finances, securely');

    fireEvent.click(screen.getByRole('button', { name: /Switch language/ }));
    expect(document.title).toBe('متابعة — تابع مالك، بأمان');
  });
});

describe('LandingPage Malafat (MUT-174)', () => {
  const link = () => within(part('malafat')).getByRole('link');

  it('speaks to law firms and accounting offices on Malafat, with one link to Malafat in a new tab', () => {
    renderLanding('en');
    const band = part('malafat');
    expect(within(band).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Run a law firm or accounting office on Malafat? Mutaba3a connects to it.',
    );
    expect(within(band).getAllByRole('link')).toHaveLength(1);
    expect(link()).toHaveTextContent('See Malafat');
    expect(link()).toHaveAttribute('href', malafatUrl({ locale: 'en', medium: 'landing', content: 'landing-section' }));
    expect(link()).toHaveAttribute('target', '_blank');
    expect(link().getAttribute('rel')).toContain('noopener');
  });

  it('ties the capture claim to a hosted account linked to the firm\'s Malafat and the phone app, so it never contradicts the free app', () => {
    renderLanding('en');
    expect(part('malafat')).toHaveTextContent("With a hosted account linked to your firm's Malafat");
    expect(part('malafat')).toHaveTextContent('phone app');
    expect(part('malafat')).toHaveTextContent('unallocated');
  });

  it('says the link opens in a new tab', () => {
    renderLanding('en');
    expect(link()).toHaveAccessibleName('See Malafat (opens in a new tab)');
  });

  it('reads the same in Arabic, linking to Malafat in Arabic', () => {
    renderLanding('ar');
    const band = part('malafat');
    const title = within(band).getByRole('heading', { level: 2 });
    expect(title).toHaveTextContent('المحاماة');
    expect(title).toHaveTextContent('المحاسبة');
    expect(band).toHaveTextContent('حساب مستضاف مربوط بـ Malafat مكتبك');
    expect(band).toHaveTextContent('تطبيق متابعة على الهاتف');
    expect(band).toHaveTextContent('غير مخصَّصة');
    expect(link()).toHaveAccessibleName('اطّلع على Malafat (يُفتح في علامة تبويب جديدة)');
    expect(link()).toHaveAttribute('href', malafatUrl({ locale: 'ar', medium: 'landing', content: 'landing-section' }));
  });

  it('claims nothing automatic, no sync, no reports, no price and nothing of the money-core spike', () => {
    renderLanding('en');
    expect(partCopy('malafat')).not.toMatch(BANNED_CLAIMS_EN);
    expect(partCopy('malafat')).not.toMatch(MONEY_CORE_EN);
    cleanup();
    renderLanding('ar');
    expect(bare(partCopy('malafat'))).not.toMatch(BANNED_CLAIMS_AR);
    expect(bare(partCopy('malafat'))).not.toMatch(MONEY_CORE_AR);
  });

  it('catches a banned claim however it is spelled', () => {
    for (const claim of ['payments sync', 'automated', 'automation', 'realtime', 'pricing', 'per month', 'sign-up', '₪49']) {
      expect(claim).toMatch(BANNED_CLAIMS_EN);
    }
    for (const claim of ['مزامَنة', 'تقرير', 'إحصائيات', 'أسعار', 'اشتراك', 'تلقائيًا', 'فوري']) {
      expect(bare(claim)).toMatch(BANNED_CLAIMS_AR);
    }
    for (const fine of ['رسوم الأتعاب', 'آليّة الدفع']) {
      expect(bare(fine)).not.toMatch(BANNED_CLAIMS_AR);
    }
    expect('part of Malafat').toMatch(MONEY_CORE_EN);
    expect(bare('جزء من Malafat')).toMatch(MONEY_CORE_AR);
  });
});
