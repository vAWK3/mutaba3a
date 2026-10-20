import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { chooseLanguage } from '../../../test/language';
import { useLanguage } from '../../../lib/i18n';
import { LandingProviders } from '../LandingProviders';
import { HostedRequestForm } from '../components/HostedRequestForm';
import { FIELD_MAX_LENGTH, NETLIFY_FORMS_PATH } from '../hostedRequest';

/**
 * The request-account form (MUT-186). These tests lived in HostedOfferPage.test.tsx
 * until that page was retired (7914685a); the form survived, inline under Get it,
 * so they are restored here against the form itself.
 */

/** The form as Get it mounts it: labelled by a heading, plus a language switch for the D4 test. */
function Harness() {
  const { setLanguage } = useLanguage();
  return (
    <main>
      <h3 id="request-title">Request an account</h3>
      <button type="button" onClick={() => setLanguage('ar')}>
        Switch language
      </button>
      <HostedRequestForm titleId="request-title" />
    </main>
  );
}

function renderForm(language: 'en' | 'ar' = 'en') {
  chooseLanguage(language);
  return render(
    <LandingProviders>
      <Harness />
    </LandingProviders>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

function fillRequired(name = 'Lina Haddad', email = 'lina@example.com') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /Send request|Try again/ }));

const sentBodies = () => fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HostedRequestForm fields', () => {
  it('asks only for a name and an email, marking every other field optional', () => {
    renderForm();
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
    renderForm('ar');
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('واتساب أو هاتف (اختياري)')).toHaveAttribute('dir', 'ltr');
  });

  it('hides the honeypot from people, screen readers and autofill (display: none via hidden)', () => {
    renderForm();
    const trap = document.querySelector<HTMLInputElement>('input[name="bot-field"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[hidden]')).not.toBeNull();
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('caps every typed field at its limit', () => {
    renderForm();
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.name));
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.email));
    expect(screen.getByLabelText('WhatsApp or phone (optional)')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.phone));
    expect(screen.getByLabelText('Anything else we should know? (optional)')).toHaveAttribute('maxLength', String(FIELD_MAX_LENGTH.message));
  });

  it('says where the details go, right under the button (D3)', () => {
    renderForm();
    const notice = screen.getByText(/We use these details only to reply with an offer\./);
    expect(within(notice).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
    expect(within(notice).getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms');
  });
});

describe('HostedRequestForm validation', () => {
  it('stops an empty request, marks both required fields and moves focus to the first', () => {
    renderForm();
    submit();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText(/Enter an email address like .*name@example\.com/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves focus to the email when only the email is wrong', () => {
    renderForm();
    fillRequired('Lina', 'lina@');
    submit();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('clears a field’s error as soon as it is edited', () => {
    renderForm();
    submit();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'L' } });
    expect(screen.queryByText('Enter your name.')).toBeNull();
  });

  it('refuses an over-long value that got past the attribute, saying how long is allowed', () => {
    renderForm();
    fillRequired('a'.repeat(FIELD_MAX_LENGTH.name + 1));
    submit();
    expect(screen.getByText(`Use ${FIELD_MAX_LENGTH.name} characters or fewer.`)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to send an over-long message, and moves focus to it', () => {
    renderForm();
    fillRequired();
    fireEvent.change(screen.getByLabelText('Anything else we should know? (optional)'), {
      target: { value: 'a'.repeat(FIELD_MAX_LENGTH.message + 1) },
    });
    submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Anything else we should know? (optional)')).toHaveFocus();
  });
});

describe('HostedRequestForm sending', () => {
  it('posts every answer, the page language and the form name to Netlify', async () => {
    renderForm('ar');
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'لينا' } });
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'lina@example.com' } });
    fireEvent.change(screen.getByLabelText('ماذا تعمل؟ (اختياري)'), { target: { value: 'lawyer' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'iPhone' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'حاسوب' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'iPhone' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'iPhone' }));
    fireEvent.click(screen.getByRole('button', { name: 'أرسل الطلب' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe(NETLIFY_FORMS_PATH);
    const [body] = sentBodies();
    expect(Object.fromEntries(body!)).toMatchObject({
      'form-name': 'hosted-request',
      name: 'لينا',
      email: 'lina@example.com',
      profession: 'lawyer',
      devices: 'computer, iphone',
      language: 'ar',
      'bot-field': '',
    });
    expect(body!.get('request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('disables the button and says so while sending, so a second click sends nothing', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderForm();
    fillRequired();
    submit();
    const button = await screen.findByRole('button', { name: 'Sending…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response(null, { status: 200 }));
    await screen.findByRole('heading', { name: 'Request sent.' });
  });

  it('ignores a second submit while the first is in flight, whatever triggers it', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderForm();
    fillRequired();
    submit();
    await screen.findByRole('button', { name: 'Sending…' });
    fireEvent.submit(screen.getByRole('form', { name: 'Request an account' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still works where crypto.randomUUID is missing (plain http, older Safari)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    renderForm();
    fillRequired();
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]!.get('request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends the language the page is in at send time, not the one it opened in (D4)', async () => {
    renderForm('en');
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'لينا' } });
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'lina@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'أرسل الطلب' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]!.get('language')).toBe('ar');
  });
});

describe('HostedRequestForm outcome', () => {
  it('confirms with the visitor’s own name and email, the reply window and focus on the heading (2A, 4A)', async () => {
    renderForm();
    fillRequired();
    submit();
    const heading = await screen.findByRole('heading', { name: 'Request sent.' });
    await waitFor(() => expect(heading).toHaveFocus());
    const panel = screen.getByRole('status');
    expect(panel).toHaveTextContent('Lina Haddad');
    expect(panel).toHaveTextContent('lina@example.com');
    expect(panel).toHaveTextContent('within 2 working days');
    expect(within(panel).getByRole('link', { name: 'Back to the homepage' })).toHaveAttribute('href', '#top');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('lets the visitor fix a mistyped email and send again, with every answer kept (2A)', async () => {
    renderForm();
    fillRequired('Lina', 'lina@gmial.com');
    fireEvent.change(screen.getByLabelText('WhatsApp or phone (optional)'), { target: { value: '+970 59 000' } });
    fireEvent.change(screen.getByLabelText('Anything else we should know? (optional)'), { target: { value: 'Two clients' } });
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Wrong email? Edit and send again' }));
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('lina@gmial.com');
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByLabelText('WhatsApp or phone (optional)')).toHaveValue('+970 59 000');
    expect(screen.getByLabelText('Anything else we should know? (optional)')).toHaveValue('Two clients');
    fireEvent.change(email, { target: { value: 'lina@gmail.com' } });
    submit();
    await screen.findByRole('heading', { name: 'Request sent.' });
    const [first, second] = sentBodies();
    expect(second!.get('email')).toBe('lina@gmail.com');
    // One request id for the typo'd send and its correction, so Basel can tell they are one request
    expect(second!.get('request-id')).toBe(first!.get('request-id'));
  });

  it('keeps the answers and offers a retry when sending fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    renderForm();
    fillRequired();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send. Check your connection and try again.");
    expect(screen.getByLabelText('Name')).toHaveValue('Lina Haddad');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Request sent.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = sentBodies().map((body) => body.get('request-id'));
    expect(ids[1]).toBe(ids[0]);
  });
});
