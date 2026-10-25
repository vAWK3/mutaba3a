import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { CopyField } from '../CopyField';

const utils = vi.hoisted(() => ({ copyToClipboard: vi.fn<(text: string) => Promise<boolean>>() }));
vi.mock('../../../lib/utils', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/utils')>()), copyToClipboard: utils.copyToClipboard }));

/** MUT-434: CopyField — a read-only, left-to-right value with Copy; "Copied" or a failure is announced politely. */
afterEach(() => localStorage.clear());

describe('CopyField', () => {
  function renderField() {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
    return render(
      <HostedLanguageProvider>
        <CopyField label="MCP address" value="https://app.example.test/mcp" />
      </HostedLanguageProvider>,
    );
  }

  it('copies the value and says so', async () => {
    utils.copyToClipboard.mockResolvedValue(true);
    renderField();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy' }));
    expect(utils.copyToClipboard).toHaveBeenCalledWith('https://app.example.test/mcp');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('says when the copy failed, so the person copies by hand', async () => {
    utils.copyToClipboard.mockResolvedValue(false);
    renderField();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t copy');
    expect(screen.getByLabelText('MCP address')).toHaveAttribute('readonly');
  });
});
