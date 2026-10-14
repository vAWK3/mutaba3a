import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { LandingProviders } from '../LandingProviders';
import { HostedOfferPage } from '../HostedOfferPage';
import { FIELD_MAX_LENGTH, NETLIFY_FORMS_PATH } from '../hostedRequest';
import { WEB_APP_URL } from '../../../content/download-config';

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

function renderPage(language: 'en' | 'ar' = 'en') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <LandingProviders>
      <HostedOfferPage />
    </LandingProviders>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

function fillRequired(name = 'Lina Haddad', email = 'lina@example.com') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /Send request|Try again/ }));

/** The page's own words, without the decorative product mock (its sample amounts are not prices). */
function copyText(): string {
  const main = document.querySelector('main')!.cloneNode(true) as HTMLElement;
  main.querySelectorAll('[data-part="devices-mock"]').forEach((el) => el.remove());
  return main.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  apps.links = { ios: { available: true, url: null }, android: { available: false, url: null } };
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HostedOfferPage structure', () => {
  it('renders hero, comparison, band and request form in order, inside the landing chrome', () => {
    renderPage();
    const parts = [...document.querySelectorAll('main > [data-part]')].map((el) => el.getAttribute('data-part'));
    expect(parts).toEqual(['hero', 'compare', 'band', 'request']);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('leads with a heading that names the benefit, and a sub-line that names the trade (3A)', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your records, on every device.');
    expect(document.querySelector('[data-part="hero"]')?.textContent).toContain('on our servers, behind your sign-in');
  });

  it('jumps from the hero button to the form', () => {
    renderPage();
    const cta = screen.getByRole('link', { name: 'Request an account' });
    expect(cta).toHaveAttribute('href', '#request');
    expect(document.getElementById('request')).toHaveAttribute('data-part', 'request');
  });

  it('answers the price question before it is asked, without a price', () => {
    renderPage();
    expect(document.querySelector('[data-part="hero"]')?.textContent).toContain("No price list. Tell us what you need and we'll send you an offer.");
  });

  it('shows the same client balance on a laptop and a phone, hidden from screen readers (5A)', () => {
    renderPage();
    const mock = document.querySelector('[data-part="devices-mock"]')!;
    expect(mock).toHaveAttribute('aria-hidden', 'true');
    const amounts = [...mock.querySelectorAll('[data-amount="owed"]')].map((el) => el.textContent);
    expect(amounts).toHaveLength(2);
    expect(amounts[0]).toBe(amounts[1]);
  });

  it('names the tab in the active language', () => {
    renderPage();
    expect(document.title).toBe('Mutaba3a — Hosted accounts');
  });
});

describe('HostedOfferPage comparison (1A)', () => {
  it('compares the free app and hosted in one table with a header per row', () => {
    renderPage();
    const table = screen.getByRole('table');
    const columns = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(columns).toEqual(['What changes', 'Free app', 'Hosted']);
    const rows = within(table).getAllByRole('rowheader').map((th) => th.textContent);
    expect(rows).toEqual(['Where your records live', 'Devices', 'Phone app', 'If your laptop is lost', 'Malafat', 'Account', 'Price']);
  });

  it('says what the free app lacks in words a screen reader reads, not a bare dash', () => {
    renderPage();
    const phone = screen.getByRole('rowheader', { name: 'Phone app' }).closest('tr')!;
    expect(within(phone).getAllByRole('cell')[0]).toHaveTextContent('Not included');
  });

  it('says Android is coming soon while it is not available', () => {
    renderPage();
    expect(screen.getByText('Android coming soon')).toBeInTheDocument();
  });

  it('drops the coming-soon note once Android is available', () => {
    apps.links = { ios: { available: true, url: null }, android: { available: true, url: null } };
    renderPage();
    expect(screen.queryByText('Android coming soon')).toBeNull();
  });

  it('never links an app store, even with store URLs configured: visitors have no account yet (9A)', () => {
    apps.links = {
      ios: { available: true, url: 'https://apps.apple.com/app/id1' },
      android: { available: true, url: 'https://play.google.com/store/apps/details?id=x' },
    };
    renderPage();
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => /apps\.apple\.com|play\.google\.com/.test(href))).toEqual([]);
  });
});

describe('HostedOfferPage honesty', () => {
  it('promises to move existing records by hand, never automatically (8A)', () => {
    renderPage();
    const band = document.querySelector('[data-part="band"]')!.textContent ?? '';
    expect(band).toContain("We'll move them into your hosted account with you, by hand.");
  });

  it('claims nothing the product does not do, and offers no checkout or sign-up (EN)', () => {
    renderPage();
    const text = copyText();
    for (const forbidden of [/checkout/i, /subscri/i, /per month/i, /\$\d/, /₪/, /report/i, /backup|back up/i, /automatic/i, /\bsync/i, /sign up/i, /create (an |your )?account/i, /your own profiles/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('claims nothing the product does not do in Arabic either', () => {
    renderPage('ar');
    const text = copyText();
    for (const forbidden of [/اشترك|اشتراك/, /شراء|اشترِ/, /تقارير/, /نسخ احتياطي/, /تلقائي/, /مزامنة/]) {
      expect(text).not.toMatch(forbidden);
    }
  });
});

describe('HostedRequestForm', () => {
  it('asks only for a name and an email, marking every other field optional', () => {
    renderPage();
    const form = screen.getByRole('form', { name: 'Request an account' });
    expect(within(form).getByLabelText('Name')).toBeRequired();
    expect(within(form).getByLabelText('Email')).toBeRequired();
    for (const label of ['WhatsApp or phone (optional)', 'What do you do? (optional)', 'Anything else we should know? (optional)']) {
      expect(within(form).getByLabelText(label)).not.toBeRequired();
    }
    expect(within(form).getByRole('group', { name: 'Where do you want to use it? (optional)' })).toBeInTheDocument();
    expect(within(form).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual(['iPhone', 'Android', 'Computer']);
  });

  it('keeps email and phone left to right inside an Arabic page', () => {
    renderPage('ar');
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('واتساب أو هاتف (اختياري)')).toHaveAttribute('dir', 'ltr');
  });

  it('hides the honeypot from people, screen readers and autofill (display: none via hidden)', () => {
    renderPage();
    const trap = document.querySelector<HTMLInputElement>('input[name="bot-field"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[hidden]')).not.toBeNull();
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('caps every typed field at its limit', () => {
    renderPage();
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.name));
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.email));
    expect(screen.getByLabelText('WhatsApp or phone (optional)')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.phone));
    expect(screen.getByLabelText('Anything else we should know? (optional)')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.message));
  });

  it('refuses an over-long value that got past the attribute, saying how long is allowed', () => {
    renderPage();
    fillRequired('a'.repeat(FIELD_MAX_LENGTH.name + 1));
    submit();
    expect(screen.getByText(`Use ${FIELD_MAX_LENGTH.name} characters or fewer.`)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says where the details go, right under the button (D3)', () => {
    renderPage();
    const notice = screen.getByText(/We use these details only to reply with an offer\./);
    expect(within(notice).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
  });

  it('stops an empty request, marks both required fields and moves focus to the first', () => {
    renderPage();
    submit();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText(/Enter an email address like .*name@example\.com/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves focus to the email when only the email is wrong', () => {
    renderPage();
    fillRequired('Lina', 'lina@');
    submit();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('clears a field’s error as soon as it is edited', () => {
    renderPage();
    submit();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'L' } });
    expect(screen.queryByText('Enter your name.')).toBeNull();
  });

  it('disables the button and says so while sending, so a second click sends nothing', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderPage();
    fillRequired();
    submit();
    const button = await screen.findByRole('button', { name: 'Sending…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response(null, { status: 200 }));
    await screen.findByRole('heading', { name: 'Request sent.' });
  });

  it('posts every answer, the page language and the form name to Netlify', async () => {
    renderPage('ar');
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'لينا' } });
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'lina@example.com' } });
    fireEvent.change(screen.getByLabelText('ماذا تعمل؟ (اختياري)'), { target: { value: 'lawyer' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'iPhone' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'حاسوب' }));
    fireEvent.click(screen.getByRole('button', { name: 'أرسل الطلب' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(NETLIFY_FORMS_PATH);
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      'form-name': 'hosted-request',
      name: 'لينا',
      email: 'lina@example.com',
      profession: 'lawyer',
      devices: 'iphone, computer',
      language: 'ar',
      'bot-field': '',
    });
    expect(body.get('request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses to send an over-long phone or message, and moves focus to it', () => {
    renderPage();
    fillRequired();
    fireEvent.change(screen.getByLabelText('Anything else we should know? (optional)'), {
      target: { value: 'a'.repeat(FIELD_MAX_LENGTH.message + 1) },
    });
    submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Anything else we should know? (optional)')).toHaveFocus();
  });

  it('still works where crypto.randomUUID is missing (plain http, older Safari)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    renderPage();
    fillRequired();
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends the language the page is in at send time, not the one it opened in (D4)', async () => {
    renderPage('en');
    fireEvent.click(screen.getByRole('button', { name: /Switch language/ }));
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'لينا' } });
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'lina@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'أرسل الطلب' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('language')).toBe('ar');
  });

  it('ignores a second submit while the first is in flight, whatever triggers it', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderPage();
    fillRequired();
    submit();
    await screen.findByRole('button', { name: 'Sending…' });
    fireEvent.submit(screen.getByRole('form', { name: 'Request an account' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('confirms with the visitor’s own name and email, the reply window and focus on the heading (2A, 4A)', async () => {
    renderPage();
    fillRequired();
    submit();
    const heading = await screen.findByRole('heading', { name: 'Request sent.' });
    await waitFor(() => expect(heading).toHaveFocus());
    const panel = screen.getByRole('status');
    expect(panel).toHaveTextContent('Lina Haddad');
    expect(panel).toHaveTextContent('lina@example.com');
    expect(panel).toHaveTextContent('within 2 working days');
    expect(within(panel).getByRole('link', { name: 'Keep using the free app meanwhile' })).toHaveAttribute('href', WEB_APP_URL);
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('lets the visitor fix a mistyped email and send again, with every answer kept (2A)', async () => {
    renderPage();
    fillRequired('Lina', 'lina@gmial.com');
    fireEvent.change(screen.getByLabelText('WhatsApp or phone (optional)'), { target: { value: '+970 59 000' } });
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Wrong email? Edit and send again' }));
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('lina@gmial.com');
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByLabelText('WhatsApp or phone (optional)')).toHaveValue('+970 59 000');
    fireEvent.change(email, { target: { value: 'lina@gmail.com' } });
    submit();
    await screen.findByRole('heading', { name: 'Request sent.' });
    const [first, second] = fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));
    expect(second.get('email')).toBe('lina@gmail.com');
    // One request id for the typo'd send and its correction, so Basel can tell they are one request
    expect(second.get('request-id')).toBe(first.get('request-id'));
  });

  it('keeps the answers and offers a retry when sending fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    renderPage();
    fillRequired();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send. Check your connection and try again.");
    expect(screen.getByLabelText('Name')).toHaveValue('Lina Haddad');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Request sent.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)).get('request-id'));
    expect(ids[1]).toBe(ids[0]);
  });
});

describe('HostedOfferPage language', () => {
  it('renders right to left in Arabic with no raw translation keys', () => {
    renderPage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('سجلّاتك، على كل أجهزتك.');
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });
});
