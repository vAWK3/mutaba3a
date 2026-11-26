import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ManualAllocationPanel, type ManualAllocation } from '../ManualAllocationPanel';

const utils = vi.hoisted(() => ({ copyToClipboard: vi.fn<(text: string) => Promise<boolean>>() }));
vi.mock('../../../lib/utils', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/utils')>()), copyToClipboard: utils.copyToClipboard }));

/** MUT-711 (AC1): the manual allocation panel — the Tax Authority's details with Copy, the link, the input, a way out. */
afterEach(() => localStorage.clear());

const ALLOCATION: ManualAllocation = { mode: 'MANUAL', nextNumber: 14, documentDate: '2026-11-22', net: '6000.00', customerTaxId: '516123452', requestUrl: 'https://example.test/allocation', automaticOn: null };

function renderPanel(props: Partial<Parameters<typeof ManualAllocationPanel>[0]> = {}, language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  const onChange = vi.fn();
  const onChangeAmount = vi.fn();
  render(
    <HostedLanguageProvider>
      <ManualAllocationPanel allocation={ALLOCATION} value="" onChange={onChange} invalid={false} inputId="a" onChangeAmount={onChangeAmount} {...props} />
    </HostedLanguageProvider>,
  );
  return { onChange, onChangeAmount };
}

describe('ManualAllocationPanel', () => {
  it('lists the invoice number, date, amount before VAT and VAT number; copies one or all', async () => {
    utils.copyToClipboard.mockResolvedValue(true);
    renderPanel();
    expect(screen.getByRole('heading', { name: 'This invoice needs an allocation number' })).toBeVisible();
    expect(screen.getByText('22/11/2026')).toBeVisible();
    expect(screen.getByText('516123452')).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Copy Invoice number' }));
    expect(utils.copyToClipboard).toHaveBeenLastCalledWith('14');
    await user.click(screen.getByRole('button', { name: 'Copy Amount before VAT' }));
    expect(utils.copyToClipboard).toHaveBeenLastCalledWith('6000.00');
    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(utils.copyToClipboard).toHaveBeenLastCalledWith('Invoice number: 14\nDate: 22/11/2026\nAmount before VAT: 6000.00\nClient\'s VAT number: 516123452');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(screen.getByRole('link', { name: /Open the Tax Authority's allocation page/ })).toHaveAttribute('href', 'https://example.test/allocation');
  });

  it('says the number is requested for this invoice number and is not held; flags a malformed one', () => {
    renderPanel({ invalid: true, value: '12345' });
    expect(screen.getByLabelText('Allocation number (9 digits)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('An allocation number is 9 digits.')).toBeVisible();
  });

  it('types the number and offers "change the amount"', async () => {
    const { onChange, onChangeAmount } = renderPanel();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Allocation number (9 digits)'), '1');
    expect(onChange).toHaveBeenCalledWith('1');
    await user.click(screen.getByRole('button', { name: 'change the amount' }));
    expect(onChangeAmount).toHaveBeenCalled();
    expect(screen.getByText(/Request it for invoice number 14/)).toBeVisible();
  });

  it('reads in formal Arabic', () => {
    renderPanel({}, 'ar');
    expect(screen.getByRole('heading', { name: 'تحتاج هذه الفاتورة إلى رقم تخصيص' })).toBeVisible();
  });

  it('MUT-736: on a plan without the Tax Authority connection it says numbers come automatically on Solo', () => {
    renderPanel({ allocation: { ...ALLOCATION, automaticOn: 'solo' } });
    expect(screen.getByTestId('issue-allocation-automatic-on')).toHaveTextContent('Connect to the Tax Authority to get numbers automatically, on Solo.');
  });

  it('MUT-736: in Arabic, «مستقل»; and no such line when the plan is not why', () => {
    renderPanel({ allocation: { ...ALLOCATION, automaticOn: 'solo' } }, 'ar');
    expect(screen.getByTestId('issue-allocation-automatic-on')).toHaveTextContent('في خطة «مستقل»');
  });

  it('MUT-736: no line when automaticOn is null', () => {
    renderPanel();
    expect(screen.queryByTestId('issue-allocation-automatic-on')).toBeNull();
  });
});
