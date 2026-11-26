import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, type IssuerDetails } from '../../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { DefaultsStep, DetailsStep, LOGO_MAX_BYTES, LogoStep, NumberingStep, TaxAuthorityStep } from '../InvoicingSteps';
import { Letterhead } from '../Letterhead';
import { endsSoon, wholeNumber, type PaperModel } from '../setupSteps';

const api = vi.hoisted(() => ({ lookup: vi.fn(), saveIssuer: vi.fn(), saveDefaults: vi.fn(), numbering: vi.fn(), saveLogo: vi.fn(), removeLogo: vi.fn(), taxStatus: vi.fn(), taxConnect: vi.fn(), taxDisconnect: vi.fn() }));
const drawers = vi.hoisted(() => ({ openBilling: vi.fn(), openTwoFactor: vi.fn() }));
vi.mock('../../../shell/AccountDrawers', () => ({ useAccountDrawers: () => drawers }));
vi.mock('../../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...real,
    api: { ...real.api, businessLookup: api.lookup, saveIssuer: api.saveIssuer, saveIssuerDefaults: api.saveDefaults, answerNumbering: api.numbering, saveIssuerLogo: api.saveLogo, removeIssuerLogo: api.removeLogo, taxAuthorityStatus: api.taxStatus, taxAuthorityConnect: api.taxConnect, taxAuthorityDisconnect: api.taxDisconnect, issuingStyles: async () => ({ styles: [{ key: 'PROFESSIONAL' }, { key: 'MODERN' }, { key: 'MINIMAL' }] }) },
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
const SETUP = { liveJurisdictions: ['IL'], countryLocked: false };
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '516123452', country: 'IL', dealerType: 'COMPANY', address: null, city: 'Nazareth', phone: null, email: null, website: null, ink: 'BLACK', documentStyle: 'PROFESSIONAL', pricesIncludeVat: false, defaultLanguage: 'he', paymentTermsDays: null, bankDetails: null, footerNote: null, version: 1 } as IssuerDetails;

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
  Object.values(drawers).forEach((fn) => fn.mockReset());
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
    wrap(<WithPaper step={(preview) => <DetailsStep profileId="p1" issuer={null} setup={SETUP} onPreview={preview} onDone={onDone} />} />);
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'IL');
    await userEvent.type(screen.getByLabelText('VAT file or company number'), '516123452');
    await waitFor(() => expect(screen.getByLabelText('Legal name')).toHaveValue('ברמג׳יאת בע״מ'));
    expect(screen.getByLabelText('Address')).toHaveValue('הרמון 12, נצרת');
    expect(screen.getByLabelText('Business type')).toHaveValue('COMPANY');
    expect(screen.getByTestId('letterhead')).toHaveTextContent('ברמג׳יאת בע״מ');
    expect(screen.getByTestId('letterhead')).toHaveTextContent('ח.פ. 516123452');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.saveIssuer).toHaveBeenCalledWith('p1', null, { country: 'IL', vatId: '516123452', legalName: 'ברמג׳יאת בע״מ', dealerType: 'COMPANY', address: 'הרמון 12, נצרת', city: null, phone: null, email: null });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('details: refuses to save without a complete number and a legal name', async () => {
    api.lookup.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'not found', { reason: 'NOT_IN_REGISTRY' }));
    wrap(<DetailsStep profileId="p1" issuer={null} setup={SETUP} onPreview={() => undefined} onDone={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'IL');
    await userEvent.type(screen.getByLabelText('VAT file or company number'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('This number is not valid. Please check the digits.')).toBeInTheDocument();
    expect(screen.getByText('Enter the legal name.')).toBeInTheDocument();
    expect(api.saveIssuer).not.toHaveBeenCalled();
  });

  it('details (MUT-740): the country has no default for a new profile, and saving asks for one', async () => {
    wrap(<DetailsStep profileId="p1" issuer={null} setup={SETUP} onPreview={() => undefined} onDone={() => undefined} />);
    expect(screen.getByLabelText('Country')).toHaveValue('');
    expect(screen.queryByTestId('country-not-live')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Choose the country of the business.')).toBeInTheDocument();
    expect(api.saveIssuer).not.toHaveBeenCalled();
  });

  it('details (MUT-740): a country that is not live shows the notice, disables Next and saves nothing', async () => {
    wrap(<DetailsStep profileId="p1" issuer={null} setup={SETUP} onPreview={() => undefined} onDone={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'JO');
    expect(screen.getByTestId('country-not-live')).toHaveTextContent("Invoicing isn't available for businesses in Jordan yet.");
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'IL');
    expect(screen.queryByTestId('country-not-live')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(api.saveIssuer).not.toHaveBeenCalled();
  });

  it('details (MUT-740): a saved profile shows its country, and after the first document it is locked', () => {
    wrap(<DetailsStep profileId="p1" issuer={ISSUER} setup={{ ...SETUP, countryLocked: true }} onPreview={() => undefined} onDone={() => undefined} />);
    expect(screen.getByLabelText('Country')).toHaveValue('IL');
    expect(screen.getByLabelText('Country')).toBeDisabled();
    expect(screen.getByText("The country can't be changed after the first document.")).toBeInTheDocument();
  });

  it('details (MUT-740): the Arabic labels read right to left, with the notice in Arabic', async () => {
    wrap(<DetailsStep profileId="p1" issuer={null} setup={SETUP} onPreview={() => undefined} onDone={() => undefined} />, 'ar');
    await userEvent.selectOptions(screen.getByLabelText('الدولة'), 'JO');
    expect(screen.getByTestId('country-not-live')).toHaveTextContent('إصدار الفواتير غير متاح بعد للأعمال في الأردن.');
  });

  it('details (MUT-740): the server refusing the number’s check digit reads as an invalid number', async () => {
    api.lookup.mockResolvedValue({ taxId: '516123452', kind: 'company', name: 'X', nameEn: null, status: 'פעילה', active: true, address: null });
    api.saveIssuer.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED' as never, 'invalid', { reason: 'VAT_ID_INVALID' }));
    wrap(<DetailsStep profileId="p1" issuer={null} setup={SETUP} onPreview={() => undefined} onDone={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'IL');
    await userEvent.type(screen.getByLabelText('VAT file or company number'), '516123452');
    await waitFor(() => expect(screen.getByLabelText('Legal name')).toHaveValue('X'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('This number is not valid. Please check the digits.')).toBeInTheDocument();
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
    expect(api.saveDefaults).toHaveBeenCalledWith('p1', 1, { documentStyle: 'MODERN', ink: 'BLUE', defaultLanguage: 'en', pricesIncludeVat: false, paymentTermsDays: 30, bankDetails: null, footerNote: null, offerAfterSave: true, defaultDocumentsPreference: 'ON_PAYMENT' });
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

describe('the Tax Authority step (MUT-571 follow-ups)', () => {
  const DAY = 86_400_000;
  const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
  const connected = (until: string) => ({ state: 'connected', connectedAt: inDays(-80), until, environment: 'sandbox' });

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('ends soon only within the last ten days, never after the end', () => {
    const now = new Date('2026-11-22T10:00:00Z');
    expect(endsSoon('2026-12-02T10:00:00Z', now)).toBe(true);
    expect(endsSoon('2026-12-02T10:00:01Z', now)).toBe(false);
    expect(endsSoon('2026-11-22T09:59:59Z', now)).toBe(false);
    expect(endsSoon(null, now)).toBe(false);
  });

  it('AC3: ten days before the end it says so and offers Connect again; earlier it just says connected', async () => {
    api.taxStatus.mockResolvedValue(connected(inDays(6)));
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    expect(await screen.findByTestId('tax-authority-ending')).toHaveTextContent('ends on');
    expect(screen.getByTestId('tax-authority-connect')).toHaveTextContent('Connect again');
  });

  it('a connection with weeks left shows "connected until" and no Connect', async () => {
    api.taxStatus.mockResolvedValue(connected(inDays(40)));
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    expect(await screen.findByTestId('tax-authority-connected')).toBeInTheDocument();
    expect(screen.queryByTestId('tax-authority-connect')).toBeNull();
  });

  it('back from a refused consent it says the connection was not approved, in Arabic too', async () => {
    window.history.replaceState(null, '', '/p/p1/you/invoicing?taxAuthority=refused');
    api.taxStatus.mockResolvedValue({ state: 'none', connectedAt: null, until: null, environment: null });
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />, 'ar');
    expect(await screen.findByTestId('tax-authority-returned')).toHaveTextContent('لم تتم الموافقة على الربط');
  });
});

/**
 * MUT-736 (ADR-282): the connection is on Solo and above. On a plan without it (Starter) the step offers the upgrade
 * instead of Connect, and a kept connection can still be disconnected. No explanatory lines (Basel, 2026-11-26).
 */
describe('the Tax Authority step on a plan without the connection (MUT-736)', () => {
  const NOT_ON_PLAN = { allowed: false, nextPlan: 'solo' } as const;
  const ALLOWED = { allowed: true, nextPlan: null } as const;
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('offers Upgrade to Solo (Billing) and no Connect, with no explanatory line', async () => {
    api.taxStatus.mockResolvedValue({ state: 'none', connectedAt: null, until: null, environment: null, plan: NOT_ON_PLAN });
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('tax-authority-step')).toHaveAttribute('data-plan-allowed', 'false'));
    expect(screen.queryByTestId('tax-authority-connect')).toBeNull();
    expect(screen.queryByText(/Solo and above/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Upgrade to Solo' }));
    expect(drawers.openBilling).toHaveBeenCalledWith();
  });

  it('a kept connection (suspended) can still be disconnected', async () => {
    api.taxStatus.mockResolvedValue({ state: 'suspended', connectedAt: new Date().toISOString(), until: null, environment: 'sandbox', plan: NOT_ON_PLAN });
    api.taxDisconnect.mockResolvedValue(undefined);
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('tax-authority-step')).toHaveAttribute('data-state', 'suspended'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(api.taxDisconnect).toHaveBeenCalledWith('p1');
  });

  it('in Arabic the button names «مستقل»', async () => {
    api.taxStatus.mockResolvedValue({ state: 'none', connectedAt: null, until: null, environment: null, plan: NOT_ON_PLAN });
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />, 'ar');
    expect(await screen.findByRole('button', { name: 'الترقية إلى «مستقل»' })).toBeVisible();
  });

  it('back from a connect the plan no longer allowed: says nothing was connected', async () => {
    window.history.replaceState(null, '', '/p/p1/you/invoicing?taxAuthority=plan');
    api.taxStatus.mockResolvedValue({ state: 'none', connectedAt: null, until: null, environment: null, plan: NOT_ON_PLAN });
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    expect(await screen.findByTestId('tax-authority-returned')).toHaveTextContent('Nothing was connected.');
  });

  it('a PLAN_LIMIT refusal on Connect (the plan changed meanwhile) reads the status again instead of a generic failure', async () => {
    api.taxStatus.mockResolvedValueOnce({ state: 'none', connectedAt: null, until: null, environment: null, plan: ALLOWED }).mockResolvedValue({ state: 'none', connectedAt: null, until: null, environment: null, plan: NOT_ON_PLAN });
    api.taxConnect.mockRejectedValue(new ApiError(409, 'PLAN_LIMIT', 'The Tax Authority connection is on Solo and above', { limit: 'taxAuthority', plan: 'starter', nextPlan: 'solo', canUpgrade: true }));
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    await userEvent.setup().click(await screen.findByTestId('tax-authority-connect'));
    expect(await screen.findByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
    expect(screen.queryByText('The changes could not be saved. Please try again.')).toBeNull();
  });

  it('on a paid plan it offers Connect and no upgrade', async () => {
    api.taxStatus.mockResolvedValue({ state: 'none', connectedAt: null, until: null, environment: null, plan: ALLOWED });
    wrap(<TaxAuthorityStep profileId="p1" onDone={() => undefined} />);
    expect(await screen.findByTestId('tax-authority-connect')).toBeVisible();
    expect(screen.queryByTestId('tax-authority-upgrade')).toBeNull();
  });
});
