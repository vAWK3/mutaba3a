import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { ApiError, type Currency, type DueEntryRef, type DueItem, type HostedProfile, type IssueDueResult } from '../../api/client';
import { AttachExternalInvoiceDrawer, type ExternalEntry } from '../../components/AttachExternalInvoiceDrawer';
import { InPlaceConfirm } from '../../components/InPlaceConfirm';
import { IssueDocumentDrawer, type IssueStart } from '../../components/IssueDocumentDrawer';
import { Skeleton } from '../../components/QueryView';
import { SectionTabs } from '../../components/SectionTabs';
import { useToast } from '../../components/Toast';
import { useDocumentsDue, useIssueDue, useMarkNotForInvoice, type DueView } from '../../data/documentsDueQueries';
import { useIssuingSetup } from '../../data/issuingQueries';
import { useCustomerDirectory } from '../../data/queries';
import { formatDay } from '../../format/dates';
import { formatDecimal } from '../../format/DecimalAmount';
import { useWritableFor } from '../../session/me';
import { documentTabs } from './issuedTabs';
import { PageHeader, useBackTo } from './shared';

/**
 * MUT-660 (ADR-270, wireframe screen 2): Documents › To issue. What each income entry is due, by client (No client
 * last), each group with Issue all and each row with Issue (the issue drawer, filled in). A row that can't be issued
 * here says why and offers Attach (an invoice issued elsewhere) and Not for invoice. Rows can be selected for one bulk
 * Not for invoice (or Back to invoice in the other view), confirmed in place with the count, with Undo after.
 */

/** Canvas D21: the older-than choices, in months (0 = any date). */
export const OLDER_THAN_MONTHS = [0, 1, 3, 6, 12] as const;

type Group = { customerId: string | null; items: DueItem[] };
const keyOf = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`;
const refOf = (item: DueItem): DueEntryRef => ({ kind: item.entry.kind, id: item.entry.id });

export function DocumentsDuePage({ profile }: { profile: HostedProfile }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const toast = useToast();
  const [view, setView] = useState<DueView>('to-issue');
  const [olderThan, setOlderThan] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [groupConfirm, setGroupConfirm] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<IssueStart | null>(null);
  const [attach, setAttach] = useState<ExternalEntry | null>(null);
  const setup = useIssuingSetup(profile.id);
  const due = useDocumentsDue(profile.id, view, olderThan, !!setup.data);
  const names = useCustomerDirectory(profile.id);
  const issueAll = useIssueDue(profile.id);
  const mark = useMarkNotForInvoice(profile.id);
  const writable = useWritableFor(profile) && profile.owned === true;
  const back = useBackTo('clients');

  const nameOf = (customerId: string | null) => (customerId ? (names.data?.get(customerId)?.name ?? '—') : t('hosted.documentsDue.noClient'));
  const groups: Group[] = useMemo(() => {
    const list = (due.data?.groups ?? []).map((g) => ({ customerId: g.customerId, items: g.items }));
    return list.sort((a, b) => (a.customerId === null ? 1 : b.customerId === null ? -1 : nameOf(a.customerId).localeCompare(nameOf(b.customerId), language)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.data, names.data, language]);
  const shown = groups.flatMap((g) => g.items);
  const chosen = shown.filter((i) => selected.has(keyOf(i.entry)));

  if (setup.error instanceof ApiError && setup.error.status === 404) return null;

  const resetSelection = () => {
    setSelected(new Set());
    setBulkConfirm(false);
  };
  const toggle = (item: DueItem) => {
    const next = new Set(selected);
    const k = keyOf(item.entry);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
    setBulkConfirm(false);
  };
  const toggleGroup = (g: Group, on: boolean) => {
    const next = new Set(selected);
    for (const i of g.items) {
      if (on) next.add(keyOf(i.entry));
      else next.delete(keyOf(i.entry));
    }
    setSelected(next);
    setBulkConfirm(false);
  };
  const changeView = (next: DueView) => {
    setView(next);
    resetSelection();
  };

  const runBulk = () => {
    const items = chosen.map(refOf);
    const value = view === 'to-issue';
    mark.mutate(
      { items, value },
      {
        onSuccess: ({ changed }) => {
          resetSelection();
          toast(value ? tp('hosted.documentsDue.toastMarked', changed) : tp('hosted.documentsDue.toastBack', changed), {
            tone: 'info',
            action: { label: t('hosted.documentsDue.undo'), onAction: () => mark.mutate({ items, value: !value }) },
          });
        },
        onError: (error) => {
          setBulkConfirm(false);
          const reason = error instanceof ApiError ? (error.details as { reason?: string } | null)?.reason : undefined;
          toast(reason === 'HAS_TAX_DOCUMENT' ? t('hosted.documentsDue.creditNoteFirst') : t('hosted.documentsDue.markFailed'));
        },
      },
    );
  };

  const runIssueAll = (g: Group) => {
    const items = g.items.filter((i) => i.issuable).map(refOf);
    issueAll.mutate(
      { customerId: g.customerId, items },
      {
        onSuccess: (result) => {
          setGroupConfirm(null);
          toast(issueSummary(result, tp, nameOf(g.customerId)), { tone: result.issued === items.length ? 'info' : 'error' });
        },
        onError: () => {
          setGroupConfirm(null);
          toast(t('hosted.documentsDue.issueFailed'));
        },
      },
    );
  };

  const openIssue = (item: DueItem) =>
    setDrawer({
      ...(item.customerId ? { customerId: item.customerId } : {}),
      docType: item.kind as IssueStart['docType'],
      fromEntry: { kind: item.entry.kind, id: item.entry.id },
      pricesIncludeVat: true,
      lines: [{ description: t('hosted.issue.offer.line'), kind: 'SERVICE', quantity: '1', unitPrice: item.amount, discount: '', pricesIncludeVat: true }],
      ...(item.appliesToDocumentId ? { appliesToDocumentId: item.appliesToDocumentId } : {}),
    });

  const openAttach = (item: DueItem) =>
    setAttach({ kind: item.entry.kind === 'owed' ? 'OWED' : 'RECEIVED', id: item.entry.id, client: nameOf(item.customerId), amount: item.amount, currency: item.currency as Currency });

  const markOne = (item: DueItem, value: boolean) =>
    mark.mutate(
      { items: [refOf(item)], value },
      {
        onSuccess: () => toast(value ? tp('hosted.documentsDue.toastMarked', 1) : tp('hosted.documentsDue.toastBack', 1), { tone: 'info', action: { label: t('hosted.documentsDue.undo'), onAction: () => mark.mutate({ items: [refOf(item)], value: !value }) } }),
        onError: (error) => {
          const reason = error instanceof ApiError ? (error.details as { reason?: string } | null)?.reason : undefined;
          toast(reason === 'HAS_TAX_DOCUMENT' ? t('hosted.documentsDue.creditNoteFirst') : t('hosted.documentsDue.markFailed'));
        },
      },
    );

  return (
    <section className="hp-issued hp-due" aria-labelledby="hp-due-title">
      <PageHeader title={t('hosted.documents.title')} back={back} />
      <SectionTabs {...documentTabs(profile.id, t)} />
      <h2 id="hp-due-title" className="sr-only">
        {t('hosted.documentsDue.title')}
      </h2>
      <div className="hp-due-toolbar">
        <div className="hp-home-switch" role="group" aria-label={t('hosted.documentsDue.viewLabel')}>
          {(['to-issue', 'not-for-invoice'] as const).map((v) => (
            <button key={v} type="button" className="press" aria-pressed={view === v} onClick={() => changeView(v)} data-testid={`due-view-${v}`}>
              {v === 'to-issue' ? t('hosted.documentsDue.viewToIssue') : t('hosted.documentsDue.viewNotForInvoice')}
              {view === v && due.data ? ` · ${due.data.counts.total}` : ''}
            </button>
          ))}
        </div>
        <div className="hp-due-filters">
          <label htmlFor="hp-due-older" className="hp-muted">
            {t('hosted.documentsDue.olderThan')}
          </label>
          <Select
            id="hp-due-older"
            value={String(olderThan)}
            onChange={(e) => {
              setOlderThan(OLDER_THAN_MONTHS.find((m) => String(m) === e.target.value) ?? 0);
              resetSelection();
            }}
            data-testid="due-older"
          >
            {OLDER_THAN_MONTHS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('hosted.documentsDue.anyDate') : tp('hosted.documentsDue.months', m)}
              </option>
            ))}
          </Select>
          {writable && shown.length > 0 && (
            <button type="button" className="hp-link-button press" onClick={() => setSelected(new Set(shown.map((i) => keyOf(i.entry))))} data-testid="due-select-all">
              {t('hosted.documentsDue.selectAll')}
            </button>
          )}
        </div>
      </div>

      {!due.data ? (
        <Skeleton />
      ) : groups.length === 0 ? (
        <div className="hp-due-empty" data-testid="due-empty">
          <p className="hp-due-empty-title">{view === 'to-issue' ? t('hosted.documentsDue.emptyTitle') : t('hosted.documentsDue.emptyNfiTitle')}</p>
          <p className="hp-muted">{view === 'to-issue' ? t('hosted.documentsDue.emptyBody') : t('hosted.documentsDue.emptyNfiBody')}</p>
        </div>
      ) : (
        groups.map((g) => {
          const gKey = g.customerId ?? 'none';
          const issuable = g.items.filter((i) => i.issuable).length;
          const allOn = g.items.every((i) => selected.has(keyOf(i.entry)));
          return (
            <section key={gKey} className="hp-due-group" aria-label={nameOf(g.customerId)} data-testid={`due-group-${gKey}`}>
              <div className="hp-due-group-head">
                {writable && <input type="checkbox" className="hp-due-check" checked={allOn} onChange={(e) => toggleGroup(g, e.target.checked)} aria-label={t('hosted.documentsDue.selectGroup', { client: nameOf(g.customerId) })} />}
                <h3 dir="auto">{nameOf(g.customerId)}</h3>
                {writable && view === 'to-issue' && issuable > 0 && groupConfirm !== gKey && (
                  <Button size="sm" onClick={() => setGroupConfirm(gKey)} data-testid={`due-issue-all-${gKey}`}>
                    {issuable < g.items.length ? `${t('hosted.documentsDue.issueAll')} · ${issuable}` : t('hosted.documentsDue.issueAll')}
                  </Button>
                )}
              </div>
              {groupConfirm === gKey && (
                <InPlaceConfirm
                  variant="primary"
                  message={tp('hosted.documentsDue.issueAllConfirm', issuable, { client: nameOf(g.customerId) })}
                  cancelLabel={t('hosted.documentsDue.cancel')}
                  confirmLabel={tp('hosted.documentsDue.issueN', issuable)}
                  busy={issueAll.isPending}
                  onCancel={() => setGroupConfirm(null)}
                  onConfirm={() => runIssueAll(g)}
                />
              )}
              <ul className="hp-due-rows">
                {g.items.map((item) => (
                  <li key={keyOf(item.entry)} className="hp-due-row" data-testid={`due-row-${item.entry.id}`}>
                    {writable && <input type="checkbox" className="hp-due-check" checked={selected.has(keyOf(item.entry))} onChange={() => toggle(item)} aria-label={`${item.entry.number}`} />}
                    <div className="hp-due-what">
                      {item.kind ? <Badge variant={item.kind === 'PAYMENT_REQUEST' ? 'warning' : 'accent'}>{t(`hosted.documentsDue.kinds.${item.kind}`)}</Badge> : <Badge variant="neutral">{t('hosted.documentsDue.notForInvoice')}</Badge>}
                      <span className="hp-due-meta">
                        {t(item.entry.kind === 'owed' ? 'hosted.documentsDue.forOwed' : 'hosted.documentsDue.forReceived', { number: item.entry.number })} · {formatDay(item.date, language)}
                      </span>
                      {view === 'to-issue' && item.reason && <span className="hp-due-why">{t(`hosted.documentsDue.reasons.${item.reason}`)}</span>}
                    </div>
                    <bdi className="hp-due-amount hp-num">{formatDecimal(item.amount, item.currency as Currency, language)}</bdi>
                    {writable && (
                      <div className="hp-due-actions">
                        {view === 'not-for-invoice' ? (
                          <button type="button" className="hp-link-button press" onClick={() => markOne(item, false)} data-testid={`due-back-${item.entry.id}`}>
                            {t('hosted.documentsDue.back')}
                          </button>
                        ) : item.issuable ? (
                          <Button size="sm" variant="secondary" onClick={() => openIssue(item)} data-testid={`due-issue-${item.entry.id}`}>
                            {t('hosted.documentsDue.issue')}
                          </Button>
                        ) : (
                          <>
                            <button type="button" className="hp-link-button press" onClick={() => openAttach(item)}>
                              {t('hosted.documentsDue.attach')}
                            </button>
                            <button type="button" className="hp-link-button press" onClick={() => markOne(item, true)} data-testid={`due-nfi-${item.entry.id}`}>
                              {t('hosted.documentsDue.notForInvoice')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {writable && chosen.length > 0 && (
        <div className="hp-due-bulk" data-testid="due-bulk">
          {bulkConfirm ? (
            <InPlaceConfirm
              variant="primary"
              message={view === 'to-issue' ? tp('hosted.documentsDue.markConfirm', chosen.length) : tp('hosted.documentsDue.backConfirm', chosen.length)}
              cancelLabel={t('hosted.documentsDue.cancel')}
              confirmLabel={view === 'to-issue' ? tp('hosted.documentsDue.markN', chosen.length) : tp('hosted.documentsDue.backN', chosen.length)}
              busy={mark.isPending}
              onCancel={() => setBulkConfirm(false)}
              onConfirm={runBulk}
            >
              <p className="hp-muted">{view === 'to-issue' ? t('hosted.documentsDue.markConfirmBody') : t('hosted.documentsDue.backConfirmBody')}</p>
            </InPlaceConfirm>
          ) : (
            <>
              <span className="hp-due-bulk-count">{tp('hosted.documentsDue.selected', chosen.length)}</span>
              <button type="button" className="hp-link-button press" onClick={resetSelection}>
                {t('hosted.documentsDue.clear')}
              </button>
              <Button size="sm" onClick={() => setBulkConfirm(true)} data-testid="due-bulk-action">
                {view === 'to-issue' ? t('hosted.documentsDue.notForInvoice') : t('hosted.documentsDue.back')}
              </Button>
            </>
          )}
        </div>
      )}

      {drawer && (
        <IssueDocumentDrawer
          profile={profile}
          start={drawer}
          onClose={() => setDrawer(null)}
          onIssued={(doc) => {
            setDrawer(null);
            toast(t('hosted.documentsDue.issuedOne', { document: `${t(`hosted.issue.types.${doc.docType}`)} ${doc.number}` }), { tone: 'info' });
          }}
        />
      )}
      {attach && <AttachExternalInvoiceDrawer profile={profile} entry={attach} existing={null} onClose={() => setAttach(null)} />}
    </section>
  );
}

/** Issue all's toast: what was issued, and what was held or refused, in one sentence. */
function issueSummary(result: IssueDueResult, tp: ReturnType<typeof useTp>, client: string): string {
  const held = result.results.filter((r) => r.status === 'held').length;
  const refused = result.results.filter((r) => r.status === 'refused').length;
  const parts = [tp('hosted.documentsDue.issuedN', result.issued, { client })];
  if (held) parts.push(tp('hosted.documentsDue.heldN', held));
  if (refused) parts.push(tp('hosted.documentsDue.refusedN', refused));
  return parts.join(' ');
}
