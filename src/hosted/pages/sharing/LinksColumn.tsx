import { useId, useMemo, useRef, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { LinkIcon } from '../../../components/icons/generated';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { HostedProfile, ShareLink } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { HostedTable, type Column } from '../../components/HostedTable';
import { InPlaceConfirm } from '../../components/InPlaceConfirm';
import { QueryView } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { useRevokeShareLink, type ShareLinksState } from '../../data/sharingQueries';
import { linkRow, liveLinks, revokeErrorOf, type LinkChip, type LinkRow } from './sharingRules';

/**
 * MUT-561 slice B (B1): the "Links with a PIN" column, on MUT-560's owner list: live links, and those that locked or
 * ended in the last day (OW5, the server's rule). A table that pins its action on a narrow window (DESIGN.md › List
 * rows); Turn off confirms in place in the row under it. A link's URL is never shown here: only the done pane had it.
 * The page leaves this column out when the list answers 404 (SHARE_LINKS off).
 */

const CHIP: Record<LinkChip, BadgeVariant> = { active: 'success', locked: 'error', ended: 'neutral' };
const MISSING = '—';

interface Shaped {
  link: ShareLink;
  row: LinkRow;
}

export function LinksColumn({ profile, query, onCreate }: { profile: HostedProfile; query: UseQueryResult<ShareLinksState>; onCreate: () => void }) {
  const { t, language } = useLanguage();
  const ids = useId();
  const showToast = useToast();
  const revoke = useRevokeShareLink(profile.id);
  const [confirming, setConfirming] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const [now] = useState(() => new Date());
  const list = query.data?.off === false ? query.data : undefined;
  const atLimit = list ? liveLinks(list.items) >= list.limit : false;

  const shaped = useMemo<Shaped[]>(() => (list?.items ?? []).map((link) => ({ link, row: linkRow(link, now, language, profile.timezone) })), [list, now, language, profile.timezone]);

  const periodText = (row: LinkRow) => t(row.period.key, row.period.vars);

  const cancel = (id: string) => {
    setConfirming(null);
    requestAnimationFrame(() => triggers.current.get(id)?.focus());
  };

  const turnOff = async (link: ShareLink) => {
    const was = link.status === 'locked' ? 'locked' : 'active';
    setConfirming(null);
    try {
      await revoke.mutateAsync(link);
    } catch (error) {
      const outcome = revokeErrorOf(error);
      if (!outcome.done) {
        showToast(t(outcome.toast));
        return;
      }
    }
    void trackPortal('share_link_revoked', { was });
    showToast(t('hosted.sharing.links.turnedOff'), { tone: 'info' });
  };

  const columns: Column<Shaped>[] = [
    {
      key: 'period',
      header: t('hosted.sharing.links.cols.period'),
      cell: ({ row }) => (
        <span className="hp-sharing-link-period">
          <span>{periodText(row)}</span>
          {row.chip !== 'active' && (
            <Badge variant={CHIP[row.chip]} size="sm">
              {t(`hosted.sharing.links.chip.${row.chip}`)}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'ends', header: t('hosted.sharing.links.cols.ends'), cell: ({ row }) => (row.ended ? t(row.ended.key, row.ended.vars) : row.ends) },
    { key: 'opened', header: t('hosted.sharing.links.cols.lastOpened'), cell: ({ row }) => row.lastOpened ?? MISSING },
    { key: 'viewers', header: t('hosted.sharing.links.cols.viewers'), numeric: true, cell: ({ row }) => <bdi>{row.viewers}</bdi> },
    {
      key: 'action',
      header: t('hosted.sharing.links.cols.actions'),
      stickyEnd: true,
      cell: ({ link, row }) =>
        row.canTurnOff && confirming !== link.id ? (
          <button
            type="button"
            ref={(node) => void triggers.current.set(link.id, node)}
            className="hp-link-button hp-danger press hp-sharing-action"
            aria-label={t('hosted.sharing.links.turnOffAria', { period: periodText(row) })}
            onClick={() => setConfirming(link.id)}
          >
            {t('hosted.sharing.links.turnOff')}
          </button>
        ) : null,
    },
  ];

  return (
    <section className="hp-sharing-column" aria-labelledby={`${ids}-heading`}>
      <div className="hp-sharing-column-head">
        <h2 id={`${ids}-heading`} className="hp-sharing-heading">
          <span className="hp-sharing-icon" aria-hidden="true">
            <LinkIcon size={20} />
          </span>
          {t('hosted.sharing.links.heading')}
        </h2>
        <Button variant="secondary" size="sm" aria-disabled={atLimit || undefined} aria-describedby={atLimit ? `${ids}-limit` : undefined} onClick={() => !atLimit && onCreate()}>
          {t('hosted.sharing.links.create')}
        </Button>
      </div>
      <QueryView queries={[query]} data={list}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <p className="hp-sharing-none">{t('hosted.sharing.links.none')}</p>
            ) : (
              <HostedTable
                label={t('hosted.sharing.links.heading')}
                columns={columns}
                rows={shaped}
                rowKey={({ link }) => link.id}
                rowClassName={({ row }) => (row.chip === 'ended' ? 'hp-sharing-ended' : undefined)}
                detail={({ link, row }) =>
                  confirming === link.id ? (
                    <InPlaceConfirm
                      appearance="row"
                      message={t('hosted.sharing.links.turnOffConfirm', { period: periodText(row) })}
                      cancelLabel={t('common.cancel')}
                      confirmLabel={t('hosted.sharing.links.turnOffAction')}
                      onCancel={() => cancel(link.id)}
                      onConfirm={() => void turnOff(link)}
                    />
                  ) : null
                }
              />
            )}
            <p className="hp-sharing-foot" id={`${ids}-limit`}>
              {atLimit ? t('hosted.sharing.links.atLimit', { limit: String(data.limit) }) : t('hosted.sharing.links.limit', { limit: String(data.limit) })}
            </p>
            <p className="hp-sharing-foot">{t('hosted.sharing.links.footnote')}</p>
          </>
        )}
      </QueryView>
    </section>
  );
}
