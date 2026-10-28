import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ToastProvider } from '../Toast';
import { QueuedReceipts } from '../ReceiptPickButton';

// The portal opens in Arabic until a person chooses (MUT-209); these cases speak English, so choose it as a person would
beforeEach(() => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en'));

const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });

/** QueuedReceipts is controlled; this holds its files the way the expense drawer does. */
function Harness({ initial = [], onChange }: { initial?: File[]; onChange?: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>(initial);
  return (
    <QueuedReceipts
      files={files}
      onChange={(next) => {
        setFiles(next);
        onChange?.(next);
      }}
    />
  );
}

function renderQueue(initial: File[] = []) {
  const onChange = vi.fn();
  const { container } = render(
    <HostedLanguageProvider>
      <ToastProvider>
        <Harness initial={initial} onChange={onChange} />
      </ToastProvider>
    </HostedLanguageProvider>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  return { input, onChange };
}

describe('QueuedReceipts (MUT-491): receipts picked before the expense exists', () => {
  it('offers Add receipt, takes several files in one pick, and says they are added on save', () => {
    const { input } = renderQueue();
    expect(screen.getByRole('button', { name: 'Add receipt' })).toBeInTheDocument();
    expect(input.multiple).toBe(true);
    fireEvent.change(input, { target: { files: [pdf('taxi.pdf'), pdf('hotel.pdf')] } });
    expect(screen.getByText('taxi.pdf')).toBeInTheDocument();
    expect(screen.getByText('hotel.pdf')).toBeInTheDocument();
    expect(screen.getByText("They're added when you save.")).toBeInTheDocument();
  });

  it('refuses a file the server would refuse, with the existing message, and keeps the good ones', () => {
    const { input, onChange } = renderQueue();
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' }), pdf('taxi.pdf')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Receipts must be a PDF, JPEG or PNG file.');
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'taxi.pdf' })]);
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });

  it('Remove takes a queued file back out', () => {
    renderQueue([pdf('taxi.pdf'), pdf('hotel.pdf')]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.queryByText('taxi.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('hotel.pdf')).toBeInTheDocument();
  });

  it('never queues an 11th file, and names the ones left out', () => {
    const nine = Array.from({ length: 9 }, (_, i) => pdf(`r${i + 1}.pdf`));
    const { input, onChange } = renderQueue(nine);
    fireEvent.change(input, { target: { files: [pdf('tenth.pdf'), pdf('eleventh.pdf')] } });
    expect(onChange).toHaveBeenLastCalledWith([...nine, expect.objectContaining({ name: 'tenth.pdf' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('An expense holds at most 10 receipts. Not added:');
    expect(screen.getByRole('alert')).toHaveTextContent('eleventh.pdf');
    expect(screen.getByRole('button', { name: 'Add receipt' })).toBeDisabled();
  });

  it('a pick with a refused file and one over the cap says both, in the one toast', () => {
    const nine = Array.from({ length: 9 }, (_, i) => pdf(`r${i + 1}.pdf`));
    const { input, onChange } = renderQueue(nine);
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' }), pdf('tenth.pdf'), pdf('eleventh.pdf')] } });
    expect(onChange).toHaveBeenLastCalledWith([...nine, expect.objectContaining({ name: 'tenth.pdf' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('Receipts must be a PDF, JPEG or PNG file.');
    expect(screen.getByRole('alert')).toHaveTextContent('An expense holds at most 10 receipts. Not added:');
    expect(screen.getByRole('alert')).toHaveTextContent('eleventh.pdf');
  });
});
