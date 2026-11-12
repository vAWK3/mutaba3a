import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../lib/i18n/core';
import { api } from '../api/client';
import { MalafatMark } from './MalafatMark';

/** MUT-596: the query key of a profile's members (GET /v1/members). */
const profileMembersKey = (profileId: string) => ['profiles', profileId, 'members'] as const;

/**
 * MUT-596 (ADR-254 D2): who is on a firm Malafat manages, read-only, on You › Profiles under the open firm (a firm
 * has no edit pane: nobody owns it as a person). Each seat shows
 * its Malafat role and what that lets it do here; seats not signed in to MTB3A yet say so. Changes happen in Malafat,
 * so there is nothing to press. On a firm Malafat doesn't manage, or while the list can't load, it shows nothing.
 */
export function MalafatMembersSection({ profileId }: { profileId: string }) {
  const t = useT();
  const ids = useId();
  const members = useQuery({ queryKey: profileMembersKey(profileId), queryFn: ({ signal }) => api.profileMembers(profileId, signal), retry: false });
  if (!members.data?.managedInMalafat) return null;

  return (
    <section className="hp-owners hp-you-members" aria-labelledby={`${ids}-heading`}>
      <h3 id={`${ids}-heading`} className="form-label">
        {t('hosted.members.title')}
      </h3>
      <p className="form-hint hp-title-with-mark">
        <MalafatMark size={16} />
        <span>{t('hosted.members.managed')}</span>
      </p>
      <ul className="hp-profile-list hp-owner-list" aria-labelledby={`${ids}-heading`}>
        {members.data.items.map((member, index) => (
          <li key={`${member.name}-${index}`} className="hp-owner-item">
            <div className="hp-profile-row hp-owner-row">
              <span className="hp-profile-row-text">
                <span className="hp-profile-row-line">
                  <span className="hp-profile-row-name" dir="auto" title={member.name}>
                    {member.name}
                  </span>
                  {member.you && <span className="hp-pill-open">{t('hosted.members.you')}</span>}
                </span>
                <span className="hp-option-sub">
                  {[
                    member.malafatRole && t(`hosted.members.role.${member.malafatRole}`),
                    member.pending ? t('hosted.members.pending') : member.role && t(`hosted.members.access.${member.role}`),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="form-hint">{t('hosted.members.changeHint')}</p>
    </section>
  );
}
