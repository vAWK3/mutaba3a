import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError, type Customer } from '../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { completeNumber } from '../../data/customerQueries';
import { ClientBusinessDetails } from '../ClientBusinessDetails';

const api = vi.hoisted(() => ({ lookup: vi.fn(), update: vi.fn() }));
vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>();
  return { ...real, api: { ...real.api, businessLookup: api.lookup, updateCustomer: api.update } };
});

const client = { id: 'c1', name: 'Acme', version: 3, taxId: null, address: null } as unknown as Customer;

function wrap(children: ReactNode, language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>{children}</HostedLanguageProvider>
    </QueryClientProvider>,
  );
}

const refused = (status: number, code: string, reason?: string) => new ApiError(status, code as never, 'refused', reason ? { reason } : null);

beforeEach(() => {
  localStorage.clear();
  api.lookup.mockReset();
  api.update.mockReset();
});

/** MUT-642: the client's VAT or company number and address on the client page. */
describe('ClientBusinessDetails', () => {
  it('reads a number only once it has 9 digits', () => {
    expect(completeNumber('51-612345-2')).toBe('516123452');
    expect(completeNumber('5161234')).toBeNull();
  });

  it('looks a company up, fills the empty address, and saves both', async () => {
    api.lookup.mockResolvedValue({ taxId: '516123452', kind: 'company', name: 'אקמי דיגיטל בע״מ', nameEn: null, status: 'פעילה', active: true, address: 'הרצל 5, חיפה' });
    api.update.mockResolvedValue({ ...client, version: 4, taxId: '516123452', address: 'הרצל 5, חיפה' });
    wrap(<ClientBusinessDetails profileId="p1" client={client} writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Add business details' }));
    await userEvent.type(screen.getByLabelText('VAT or company number'), '516123452');
    expect(await screen.findByText('Registrar of Companies: אקמי דיגיטל בע״מ')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue('הרצל 5, חיפה'));
    expect(api.lookup).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.update).toHaveBeenCalledWith('p1', 'c1', 3, { taxId: '516123452', address: 'הרצל 5, חיפה', name: 'אקמי דיגיטל בע״מ' });
    await waitFor(() => expect(screen.queryByLabelText('Address')).not.toBeInTheDocument());
  });

  it('keeps an address the person typed, and warns about a dissolved company', async () => {
    api.lookup.mockResolvedValue({ taxId: '516123452', kind: 'company', name: 'Old Co', nameEn: null, status: 'מחוקה', active: false, address: 'Registry St' });
    wrap(<ClientBusinessDetails profileId="p1" client={{ ...client, address: 'My St' } as Customer} writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('VAT or company number'), '516123452');
    expect(await screen.findByRole('alert')).toHaveTextContent('“מחוקה”');
    expect(screen.getByLabelText('Address')).toHaveValue('My St');
  });

  it('keeps the client’s own name when the person unticks the registered one', async () => {
    api.lookup.mockResolvedValue({ taxId: '516123452', kind: 'company', name: 'Acme Digital Ltd', nameEn: null, status: 'פעילה', active: true, address: null });
    api.update.mockResolvedValue({ ...client, version: 4, taxId: '516123452' });
    wrap(<ClientBusinessDetails profileId="p1" client={client} writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Add business details' }));
    await userEvent.type(screen.getByLabelText('VAT or company number'), '516123452');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Rename this client to the registered name/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.update).toHaveBeenCalledWith('p1', 'c1', 3, { taxId: '516123452', address: null });
  });

  it('says the client changed elsewhere on a version conflict', async () => {
    api.update.mockRejectedValue(refused(409, 'CONFLICT', 'VERSION_MISMATCH'));
    wrap(<ClientBusinessDetails profileId="p1" client={client} writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Add business details' }));
    await userEvent.type(screen.getByLabelText('Address'), 'Haifa');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This client was changed elsewhere');
  });

  it('says a sole dealer is not in the registry, and a bad check digit is not valid', async () => {
    api.lookup.mockRejectedValueOnce(refused(404, 'NOT_FOUND', 'NOT_IN_REGISTRY'));
    wrap(<ClientBusinessDetails profileId="p1" client={client} writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Add business details' }));
    const field = screen.getByLabelText('VAT or company number');
    await userEvent.type(field, '000000018');
    expect(await screen.findByText(/Not found in the registry/)).toBeInTheDocument();
    api.lookup.mockRejectedValueOnce(refused(422, 'VALIDATION_FAILED', 'TAX_ID_INVALID'));
    await userEvent.clear(field);
    await userEvent.type(field, '516123458');
    expect(await screen.findByText('This number is not valid. Check the digits.')).toBeInTheDocument();
  });

  it('shows the saved details, with no edit on a read-only profile', () => {
    wrap(<ClientBusinessDetails profileId="p1" client={{ ...client, taxId: '516123452', address: 'Haifa' } as Customer} writable={false} />);
    expect(screen.getByText('516123452')).toBeInTheDocument();
    expect(screen.getByText('Haifa')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('speaks formal Arabic', async () => {
    wrap(<ClientBusinessDetails profileId="p1" client={client} writable />, 'ar');
    expect(await screen.findByRole('button', { name: 'إضافة بيانات المنشأة' })).toBeInTheDocument();
  });
});
