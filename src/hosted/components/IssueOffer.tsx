/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { HostedProfile } from '../api/client';
import { IssueDocumentDrawer, type IssueStart } from './IssueDocumentDrawer';

/**
 * MUT-648 follow-up: the save toast's "Issue …" opens the issue drawer for the entry just saved. The toast lives for
 * six seconds above every page, but the page that saved can be left inside them (Owed → Home), and with it the income
 * drawer host. So the drawer the offer opens belongs to the profile, not to the page: this provider sits in the
 * profile's layout (keyed by profile, so a switch drops an offer), and the button still works on whatever page the
 * person is on by then.
 */
const OfferIssueContext = createContext<((start: IssueStart) => void) | null>(null);

export function IssueOfferProvider({ profile, children }: { profile: HostedProfile; children: ReactNode }) {
  const [start, setStart] = useState<IssueStart | null>(null);
  const navigate = useNavigate();
  return (
    <OfferIssueContext.Provider value={setStart}>
      {children}
      {start && (
        <IssueDocumentDrawer
          profile={profile}
          start={start}
          onClose={() => setStart(null)}
          onIssued={(doc) => {
            setStart(null);
            void navigate({ to: `/p/${profile.id}/documents/issued/${doc.id}`, search: { issued: true } } as never);
          }}
        />
      )}
    </OfferIssueContext.Provider>
  );
}

/** Opens the issue drawer for a just-saved entry; null outside a profile (no offer is made there). */
export function useOfferIssue(): ((start: IssueStart) => void) | null {
  return useContext(OfferIssueContext);
}
