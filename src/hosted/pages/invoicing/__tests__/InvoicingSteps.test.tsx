import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, type IssuerDetails } from '../../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { DefaultsStep, DetailsStep, LOGO_MAX_BYTES, LogoStep, NumberingStep } from '../InvoicingSteps';
import { Letterhead } from '../Letterhead';
import { wholeNumber, type PaperModel } from '../setupSteps';

const api = vi.hoisted(() => ({ lookup: vi.fn(), saveIssuer: vi.fn(), saveDefaults: vi.fn(), numbering: vi.fn(), saveLogo: vi.fn(), removeLogo: vi.fn() }));
vi.mock('../../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...real,
    api: { ...real.api, businessLookup: api.lookup, saveIssuer: api.saveIssuer, saveIssuerDefaults: api.saveDefaults, answerNumbering: api.numbering, saveIssuerLogo: api.saveLogo, removeIssuerLogo: api.removeLogo },
  };
});

function wrap(children: ReactNode, language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>{children}</HostedLanguageProvider>
    </QueryClientProvider>,
  );
}

const PAPER: PaperModel = { legalName: '', vatId: '', dealerType: 'LICENSED', address: '', city: '', phone: '', email: '', style: 'PROFESSIONAL', ink: 'BLACK', language: 'he', bankDetails: '', footerNote: '', logoUrl: null, nextNumber: 1 };
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '516123452', dealerType: 'COMPANY', address: null, city: 'Nazareth', phone: null, email: null, website: null, ink: 'BLACK', documentStyle: 'PROFESSIONAL', pricesIncludeVat: false, defaultLanguage: 'he', paymentTermsDays: null, bankDetails: null, footerNote: null, version: 1 } as IssuerDetails;

/** A step beside the letterhead, the way the page puts them: the paper follows the form (AC3). */
function WithPaper({ step }: { step: (preview: (patch: Partial<PaperModel>) => void) => ReactNode }) {
  const [draft, setDraft] = useState<Partial<PaperModel>>({});
  return (
    <>
      <Letterhead model={{ ...PAPER, ...draft }} current="details" done={new Set()} onPick={() => undefined} />
      {step((patch) => setDraft((d) => ({ ...d, ...patch })))}
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('invoicing setup steps (MUT-646)', () => {
  it('reads whole numbers only', () => {
    expect(wholeNumber(' 1043 ')).toBe(1043);
    expect(wholeNumber('10.5')).toBeNull();
    expect(wholeNumber('')).toBeNull();
  });

  it('details: a company number fills the name and address from the registry, the paper shows them, and it saves', async () => {
    api.lookup.mockResolvedValue({ taxId: '516123452', kind: 'company', name: 'ברמג׳יאת בע״מ', nameEn: null, status: 'פעילה', active: true, address: 'הרמון 12, נצרת' });
    api.saveIssuer.mockResolvedValue({ ...ISSUER, version: 1 });
    const onDone = vi.fn();
    wrap(<WithPaper step={(preview) => <DetailsStep profileId="p1" issuer={null} onPreview={preview} onDone={onDone} />} />);
    await userEvent.type(screen.getByLabelText('VAT file or company number'), '516123452');
    await waitFor(() => expect(screen.getByLabelText('Legal name')).toHaveValue('ברמג׳יאת בע״מ'));
    expect(screen.getByLabelText('Address')).toHaveValue('הרמון 12, נצרת');
    expect(screen.getByLabelText('Business type')).toHaveValue('COMPANY');
    expect(screen.getByTestId('letterhead')).toHaveTextContent('ברמג׳יאת בע״מ');
    expect(screen.getByTestId('letterhead')).toHaveTextContent('ח.פ. 516123452');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.saveIssuer).toHaveBeenCalledWith('p1', null, { vatId: '516123452', legalName: 'ברמג׳יאת בע״מ', dealerType: 'COMPANY', address: 'הרמון 12, נצרת', city: null, phone: null, email: null });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('details: refuses to save without a complete number and a legal name', async () => {
    api.lookup.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'not found', { reason: 'NOT_IN_REGISTRY' }));
    wrap(<DetailsStep profileId="p1" issuer={null} onPreview={() => undefined} onDone={() => undefined} />);
    await userEvent.type(screen.getByLabelText('VAT file or company number'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('This number is not valid. Please check the digits.')).toBeInTheDocument();
    expect(screen.getByText('Enter the legal name.')).toBeInTheDocument();
    expect(api.saveIssuer).not.toHaveBeenCalled();
  });

  it('defaults: style, ink and language change the paper at once (AC3), then save with the details’ version', async () => {
    api.saveDefaults.mockResolvedValue({ ...ISSUER, version: 2 });
    wrap(<WithPaper step={(preview) => <DefaultsStep profileId="p1" issuer={ISSUER} onPreview={preview} onDone={() => undefined} />} />);
    const paper = screen.getByTestId('letterhead');
    expect(paper).toHaveAttribute('data-ink', 'BLACK');
    await userEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(paper).toHaveAttribute('data-ink', 'BLUE');
    await userEvent.click(screen.getByRole('radio', { name: 'Modern' }));
    expect(paper).toHaveClass('hp-paper--modern');
    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(paper).toHaveAttribute('dir', 'ltr');
    expect(paper).toHaveTextContent('Tax invoice 1');
    await userEvent.type(screen.getByLabelText('Payment terms, in days'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.saveDefaults).toHaveBeenCalledWith('p1', 1, { documentStyle: 'MODERN', ink: 'BLUE', defaultLanguage: 'en', pricesIncludeVat: false, paymentTermsDays: 30, bankDetails: null, footerNote: null });
  });

  it('defaults: waits for the details', () => {
    wrap(<DefaultsStep profileId="p1" issuer={null} onPreview={() => undefined} onDone={() => undefined} />);
    expect(screen.getByText('Complete the business details first.')).toBeInTheDocument();
  });

  it('numbering: “No” starts from 1; “Yes” needs at least one next number and shows it on the paper', async () => {
    api.numbering.mockResolvedValue({ steps: {}, canIssue: true, missing: [], introSeen: true, hasLogo: false });
    wrap(<WithPaper step={(preview) => <NumberingStep profileId="p1" answered={false} counters={undefined} onPreview={preview} onDone={() => undefined} />} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Yes, continue my numbering' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enter the next number for at least one document type.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Tax invoice: next number'), '1043');
    expect(screen.getByTestId('letterhead')).toHaveTextContent('חשבונית מס 1043');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.numbering).toHaveBeenCalledWith('p1', { alreadyIssuing: true, starts: { TAX_INVOICE: 1043 } });
  });

  it('numbering: a type already issued here can’t be renumbered', async () => {
    const counters = { counters: [{ docType: 'TAX_INVOICE', start: 1, next: 4, hasDocuments: true }] } as never;
    wrap(<NumberingStep profileId="p1" answered counters={counters} onPreview={() => undefined} onDone={() => undefined} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Yes, continue my numbering' }));
    expect(screen.getByLabelText('Tax invoice: next number')).toBeDisabled();
  });

  it('logo: a file over 256 KB is refused before upload; the server’s refusal is said in words', async () => {
    wrap(<LogoStep profileId="p1" hasLogo={false} onPreview={() => undefined} onDone={() => undefined} />);
    const input = screen.getByTestId('logo-file');
    await userEvent.upload(input, new File([new Uint8Array(LOGO_MAX_BYTES + 1)], 'big.png', { type: 'image/png' }));
    expect(screen.getByText('The file is larger than 256 KB.')).toBeInTheDocument();
    expect(api.saveLogo).not.toHaveBeenCalled();
    api.saveLogo.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED' as never, 'no', { reason: 'LOGO_NOT_AN_IMAGE' }));
    await userEvent.upload(input, new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByText('This file is not a PNG or JPEG image that can be printed.')).toBeInTheDocument();
  });

  it('the letterhead: each region opens its step, says which it is, and is ticked once done', async () => {
    const onPick = vi.fn();
    wrap(<Letterhead model={PAPER} current="logo" done={new Set(['details'])} onPick={onPick} />, 'ar');
    const details = screen.getByRole('button', { name: 'الخطوة 1: بيانات المصلحة' });
    expect(details).toHaveAttribute('data-done', 'true');
    expect(screen.getByRole('button', { name: 'الخطوة 2: الشعار' })).toHaveAttribute('aria-current', 'step');
    await userEvent.click(screen.getByRole('button', { name: 'الخطوة 4: الترقيم' }));
    expect(onPick).toHaveBeenCalledWith('numbering');
  });
});
