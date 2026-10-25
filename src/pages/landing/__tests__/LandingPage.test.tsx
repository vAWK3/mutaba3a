import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import { LandingPage } from '../LandingPage';
import { malafatUrl } from '../../../content/malafatLinks';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';
import { resetSignupDoorForTests } from '../signupDoor';

// The store config, swapped per case through a getter so every reassignment is seen
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
 * Claims the landing's sections must never make: reports or analytics the portal
 * doesn't have, a sync or automation the capture doesn't do. Arabic is matched with
 * its diacritics stripped, so a fatha or shadda can't slip a word past it.
 */
const BANNED_CLAIMS_EN =
  /report|analytic|dashboard|statistic|chart|\/month|per month|checkout|\b(sync\w*|auto(mat\w*|-\w+)|seamless\w*|instant\w*|real[- ]?time)\b/i;
const BANNED_CLAIMS_AR = /تقرير|تقارير|تحليل|إحصا|رسوم بيانية|زامن|تلقائ|آليا|فوري|لحظي/;
/** MUT-25's still-in-progress "shared money core": the Malafat band must not describe Mutaba3a as part of Malafat. */
const MONEY_CORE_EN = /\b(module|core|engine)\b|inside malafat|within malafat|part of malafat|built into|embedded|integrat\w* into/i;
const MONEY_CORE_AR = /داخل|ضمن|جزء من|مدمج|وحدة|نواة|محر?ك/;

/** Arabic without its harakat, shadda and tatweel. */
function bare(text: string): string {
  return text.replace(/[ً-ْـ]/g, '');
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
  // One doors question per page load (MUT-369): each test is a fresh page
  resetSignupDoorForTests();
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
    expect(h1).toHaveTextContent('Log it before you forget it.');
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
  it('makes no desktop-app or local-storage claim the hosted-only product cannot keep (EN)', () => {
    renderLanding('en');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/\bBuy\b/);
    expect(text).not.toMatch(/Universal/i);
    expect(text).not.toMatch(/Intel/i);
    expect(text).not.toMatch(/download for (mac|windows)/i);
    expect(text).not.toMatch(/stored on your device/i);
  });

  it('makes the same claim in Arabic', () => {
    renderLanding('ar');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/شراء|اشترِ|اشتر /);
  });

  it('says there is no free plan, and points to requesting an account instead', () => {
    renderLanding('en');
    expect(part('faq')).toHaveTextContent('Is there a free plan?');
    fireEvent.click(screen.getByRole('button', { name: 'Is there a free plan?' }));
    expect(part('faq')).toHaveTextContent("accounts are set up for your organization");
  });
});

describe('LandingPage Get it (hosted-only)', () => {
  it('leads with a request-account form, not a download', () => {
    renderLanding('en');
    const getIt = part('get-it');
    expect(within(getIt).getByRole('heading', { name: 'Request an account' })).toBeInTheDocument();
    expect(within(getIt).getByRole('form')).toBeInTheDocument();
  });

  it('puts the request form before sign-in and the apps, so focus order follows the page', () => {
    vi.stubGlobal('__PORTAL_URL__', 'https://portal.test');
    renderLanding('en');
    const getIt = part('get-it');
    const request = getIt.querySelector('[data-part="get-it-request"]')!;
    const options = getIt.querySelector('.landing-get-it-options')!;
    expect(request.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('offers sign-in only when the build set a portal URL', () => {
    vi.stubGlobal('__PORTAL_URL__', 'https://portal.test');
    renderLanding('en');
    const signIn = within(part('get-it')).getByRole('link', { name: 'Already have an account? Sign in' });
    expect(signIn).toHaveAttribute('href', 'https://portal.test');
    vi.unstubAllGlobals();
  });

  it('offers both phone apps once their store links are configured', () => {
    apps.links = {
      ios: { available: true, url: 'https://apps.apple.com/app/id1' },
      android: { available: true, url: 'https://play.google.com/store/apps/details?id=com.barmajiyat.mutaba3a' },
    };
    renderLanding('en');
    const getIt = part('get-it');
    expect(within(getIt).getByRole('link', { name: /App Store/i })).toHaveAttribute(
      'href',
      expect.stringContaining('apps.apple.com'),
    );
    expect(within(getIt).getByRole('link', { name: /Google Play/i })).toHaveAttribute(
      'href',
      expect.stringContaining('play.google.com'),
    );
  });

  it('reads the same in Arabic', () => {
    renderLanding('ar');
    const getIt = part('get-it');
    expect(within(getIt).getByRole('heading', { name: 'اطلب حسابًا' })).toBeInTheDocument();
  });
});

describe('LandingPage phone and portal (MUT-173)', () => {
  const stores = () => within(part('phone')).getByRole('list', { name: 'Phone apps' });

  it('says the phone logs and the hosted account shows, with one link into Get it', () => {
    renderLanding('en');
    const section = part('phone');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Log it on your phone. See it all in your hosted account.',
    );
    expect(section).toHaveTextContent('The phone app is for logging');
    expect(section).toHaveTextContent('portal');
    const link = within(section).getByRole('link', { name: 'Request an account' });
    expect(link).toHaveAttribute('href', '#get-it');
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
    expect(list).toHaveTextContent('iPhone with your account');
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    expect(list.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it('never links a placeholder that is not an https URL, nor an app that is not available', () => {
    apps.links = { ios: { available: true, url: 'TBD' }, android: { available: false, url: 'https://play.google.com/x' } };
    renderLanding('en');
    const list = stores();
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    expect(list).toHaveTextContent('iPhone with your account');
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
    expect(within(section).getByRole('link', { name: 'اطلب حسابًا' })).toHaveAttribute('href', '#get-it');
    expect(within(section).getByRole('list', { name: 'تطبيقات الهاتف' })).toHaveTextContent('Android قريبًا');
  });

  it('claims no reports, analytics, or automation, in either language', () => {
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

  it('says signing in on a new device is enough — the account is the backup', () => {
    renderLanding('en');
    const questions = within(part('faq')).getAllByRole('button');
    fireEvent.click(questions[2]); // "How do I back up, or move to another device?"
    expect(part('faq')).toHaveTextContent('your account is the backup');
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
    expect(h1).toHaveTextContent('سجّله من هاتفك');
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
    expect(document.title).toBe('MTB3A — Log it before you forget it');

    fireEvent.click(screen.getByRole('button', { name: /Switch language/ }));
    expect(document.title).toBe('متابعة — سجّله من هاتفك، تابعه من كل مكان');
  });
});

describe('LandingPage Malafat (MUT-174)', () => {
  const link = () => within(part('malafat')).getByRole('link');

  it('speaks to law firms and accounting offices on Malafat, with one link to Malafat in a new tab', () => {
    renderLanding('en');
    const band = part('malafat');
    expect(within(band).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Run a law firm or accounting office on Malafat? MTB3A connects to it.',
    );
    expect(within(band).getAllByRole('link')).toHaveLength(1);
    expect(link()).toHaveTextContent('See Malafat');
    expect(link()).toHaveAttribute('href', malafatUrl({ locale: 'en', medium: 'landing', content: 'landing-section' }));
    expect(link()).toHaveAttribute('target', '_blank');
    expect(link().getAttribute('rel')).toContain('noopener');
  });

  it("ties the capture claim to the firm's Malafat linked to the account and the phone app, so it never implies Mutaba3a is part of Malafat", () => {
    renderLanding('en');
    expect(part('malafat')).toHaveTextContent("Link your firm's Malafat to your account");
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
    expect(title).toHaveTextContent('محاماة');
    expect(title).toHaveTextContent('محاسبة');
    expect(band).toHaveTextContent('اربط Malafat مكتبك بحسابك في متابعة');
    expect(band).toHaveTextContent('تطبيق الهاتف');
    expect(band).toHaveTextContent('غير مخصّصة');
    expect(link()).toHaveAccessibleName('اطّلع على Malafat (يُفتح في علامة تبويب جديدة)');
    expect(link()).toHaveAttribute('href', malafatUrl({ locale: 'ar', medium: 'landing', content: 'landing-section' }));
  });

  it('claims nothing automatic, no sync, no reports and nothing of the money-core spike', () => {
    renderLanding('en');
    expect(partCopy('malafat')).not.toMatch(BANNED_CLAIMS_EN);
    expect(partCopy('malafat')).not.toMatch(MONEY_CORE_EN);
    cleanup();
    renderLanding('ar');
    expect(bare(partCopy('malafat'))).not.toMatch(BANNED_CLAIMS_AR);
    expect(bare(partCopy('malafat'))).not.toMatch(MONEY_CORE_AR);
  });

  it('catches a banned claim however it is spelled', () => {
    for (const claim of ['payments sync', 'automated', 'automation', 'realtime']) {
      expect(claim).toMatch(BANNED_CLAIMS_EN);
    }
    for (const claim of ['مزامَنة', 'تقرير', 'إحصائيات', 'تلقائيًا', 'فوري']) {
      expect(bare(claim)).toMatch(BANNED_CLAIMS_AR);
    }
    for (const fine of ['رسوم الأتعاب', 'آليّة الدفع']) {
      expect(bare(fine)).not.toMatch(BANNED_CLAIMS_AR);
    }
    expect('part of Malafat').toMatch(MONEY_CORE_EN);
    expect(bare('جزء من Malafat')).toMatch(MONEY_CORE_AR);
  });
});

/**
 * MUT-369 (D1–D6): while the server says signup is open, the landing's way in is "Create an account" on the portal's
 * /signup, in the page language. While it is closed, or the server can't be asked, the page is exactly as today.
 */
describe('LandingPage self-service signup (MUT-369)', () => {
  const PORTAL = 'https://portal.test';
  const doors = (signup: boolean) =>
    vi.fn(async () => new Response(JSON.stringify({ signup, recovery: true }), { status: 200, headers: { 'content-type': 'application/json' } }));

  afterEach(() => vi.unstubAllGlobals());

  async function renderOpen(language: 'en' | 'ar') {
    vi.stubGlobal('__PORTAL_URL__', PORTAL);
    vi.stubGlobal('fetch', doors(true));
    renderLanding(language);
    await waitFor(() => expect(document.querySelector('.hero-cta-primary')).toHaveAttribute('href', `${PORTAL}/signup?lang=${language}`));
  }

  it('leads with "Create an account" on the portal signup page, in a new tab, in the bar too', async () => {
    await renderOpen('en');
    const hero = part('hero');
    const create = within(hero).getByRole('link', { name: /^Create an account/ });
    expect(create).toHaveAttribute('href', `${PORTAL}/signup?lang=en`);
    expect(create).toHaveAttribute('target', '_blank');
    expect(create.getAttribute('rel')).toContain('noopener');
    expect(hero).not.toHaveTextContent('Request an account');
    expect(hero).not.toHaveTextContent(/no public sign-up/);
    const bar = document.querySelector('[data-part="header-cta"]')!;
    expect(bar).toHaveAttribute('href', `${PORTAL}/signup?lang=en`);
    expect(bar).toHaveTextContent('Create an account');
  });

  it('lists Create an account first in Get it and keeps the request form for those who want help (D6)', async () => {
    await renderOpen('en');
    const getIt = part('get-it');
    const options = within(getIt).getAllByRole('link');
    expect(options[0]).toHaveAccessibleName(/^Create an account/);
    expect(options[0]).toHaveAttribute('href', `${PORTAL}/signup?lang=en`);
    expect(within(getIt).getByRole('heading', { name: 'Want us to set it up for you?' })).toBeInTheDocument();
    expect(within(getIt).getByRole('form')).toBeInTheDocument();
    expect(getIt).not.toHaveTextContent(/no public sign-up/);
    // The note says "ask us below": the options and note sit above the form
    const request = getIt.querySelector('[data-part="get-it-request"]')!;
    const note = getIt.querySelector('.landing-get-it-note')!;
    expect(note.compareDocumentPosition(request) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('points the phone chapter and the free-plan answer at signing up', async () => {
    await renderOpen('en');
    expect(within(part('phone')).getByRole('link', { name: /^Create an account/ })).toHaveAttribute('href', `${PORTAL}/signup?lang=en`);
    fireEvent.click(screen.getByRole('button', { name: 'Is there a free plan?' }));
    expect(part('faq')).toHaveTextContent('You can create an account with your email address');
  });

  it('opens signup in Arabic from the Arabic page', async () => {
    await renderOpen('ar');
    expect(within(part('hero')).getByRole('link', { name: /^أنشئ حسابًا/ })).toHaveAttribute('href', `${PORTAL}/signup?lang=ar`);
    expect(within(part('get-it')).getByRole('heading', { name: 'تريد أن نُعدّه لك؟' })).toBeInTheDocument();
  });

  it('makes no price, checkout or banned claim on the open page, in either language', async () => {
    await renderOpen('en');
    // The words signup brings (the mocks' sample amounts are not prices): no price or checkout (MUT-365 is v3)
    fireEvent.click(screen.getByRole('button', { name: 'Is there a free plan?' }));
    const signupCopy = ['.hero-cta', '.hero-cta-note', '.landing-get-it-options', '.landing-get-it-note', '#get-it-request-title', '.landing-phone-hint', '.landing-faq-answer:not([hidden])']
      .map((selector) => document.querySelector(selector)?.textContent ?? '')
      .join(' ');
    expect(signupCopy).toContain('Create an account');
    expect(signupCopy).not.toMatch(/[₪$€]\s?\d|\d\s?(₪|\$|USD|ILS)|\/month|per month|a month|checkout|trial|price/i);
    // The parts signup changes that the banned-claims rule already covers (the hero's "instantly" predates it)
    for (const name of ['get-it', 'phone']) expect(partCopy(name)).not.toMatch(BANNED_CLAIMS_EN);
    cleanup();
    resetSignupDoorForTests();
    await renderOpen('ar');
    for (const name of ['get-it', 'phone']) expect(bare(partCopy(name))).not.toMatch(BANNED_CLAIMS_AR);
  });

  it.each([
    ['closed', () => doors(false)],
    ['unreachable', () => vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))],
    ['erroring', () => vi.fn(async () => new Response('{}', { status: 503 }))],
  ])('is today\'s page while signup is %s', async (_state, makeFetch) => {
    vi.stubGlobal('__PORTAL_URL__', PORTAL);
    const fetchFn = makeFetch();
    vi.stubGlobal('fetch', fetchFn);
    renderLanding('en');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.hero-cta-primary')).toHaveAttribute('href', '#get-it');
    expect(part('hero')).toHaveTextContent('Request an account');
    expect(part('hero')).toHaveTextContent("there's no public sign-up");
    expect(within(part('get-it')).getByRole('heading', { name: 'Request an account' })).toBeInTheDocument();
    expect(within(part('phone')).getByRole('link', { name: 'Request an account' })).toHaveAttribute('href', '#get-it');
    expect(document.querySelector('main')?.textContent).not.toContain('Create an account');
  });
});
