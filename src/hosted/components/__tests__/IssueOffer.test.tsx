import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { HostedProfile } from '../../api/client';
import type { IssueStart } from '../IssueDocumentDrawer';
import { IssueOfferProvider, useOfferIssue } from '../IssueOffer';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../IssueDocumentDrawer', () => ({
  IssueDocumentDrawer: ({ start, onClose, onIssued }: { start: IssueStart; onClose: () => void; onIssued: (doc: { id: string }) => void }) => (
    <div role="dialog" aria-label="Issue a document" data-doc-type={start.docType}>
      <button type="button" onClick={onClose}>
        Close
      </button>
      <button type="button" onClick={() => onIssued({ id: 'doc-1' })}>
        Issue
      </button>
    </div>
  ),
}));

const PROFILE = { id: 'p1', name: 'Nour Studio' } as HostedProfile;
const START = { docType: 'TAX_INVOICE' } as IssueStart;

/** The page that saved: it hands the offer out, then is left (unmounted) before the toast's button is used. */
function SavingPage({ grab }: { grab: (offer: (start: IssueStart) => void) => void }) {
  const offer = useOfferIssue();
  if (offer) grab(offer);
  return <p>Owed</p>;
}

function Layout({ grab }: { grab: (offer: (start: IssueStart) => void) => void }) {
  const [onOwed, setOnOwed] = useState(true);
  return (
    <IssueOfferProvider profile={PROFILE}>
      {onOwed ? <SavingPage grab={grab} /> : <p>Home</p>}
      <button type="button" onClick={() => setOnOwed(false)}>
        Go home
      </button>
    </IssueOfferProvider>
  );
}

describe('the after-save Issue offer (MUT-648 follow-up)', () => {
  it('still opens the issue drawer after the page that saved is left inside the toast window', () => {
    let offer: ((start: IssueStart) => void) | null = null;
    render(<Layout grab={(o) => (offer = o)} />);
    act(() => screen.getByRole('button', { name: 'Go home' }).click());
    expect(screen.queryByText('Owed')).toBeNull();
    act(() => offer!(START));
    expect(screen.getByRole('dialog', { name: 'Issue a document' })).toHaveAttribute('data-doc-type', 'TAX_INVOICE');
  });

  it('closes, and on issue goes to the new document', () => {
    let offer: ((start: IssueStart) => void) | null = null;
    render(<Layout grab={(o) => (offer = o)} />);
    act(() => offer!(START));
    act(() => screen.getByRole('button', { name: 'Close' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => offer!(START));
    act(() => screen.getByRole('button', { name: 'Issue' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: '/p/p1/documents/issued/doc-1', search: { issued: true } });
  });

  it('offers nothing outside a profile', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = useOfferIssue();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeNull();
  });
});
