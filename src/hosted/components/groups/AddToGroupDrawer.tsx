import { useId, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { useLanguage } from '../../../lib/i18n/core';
import type { Expense, ExpenseGroup } from '../../api/client';
import { pickerWindow } from '../../data/expenseGroups';
import { usePickerPool } from '../../data/expenseGroupQueries';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { Drawer } from '../Drawer';
import { Skeleton, Unreachable } from '../QueryView';

/**
 * "Add from outside these dates" (MUT-268 12A): the 30 days before the start
 * (and, once the group has an end, the 30 after), minus what is already in the
 * group; tick several, and they are kept one save at a time. A partial result
 * keeps the drawer open on what failed, with Retry for just those.
 */

type Side = 'before' | 'after';

export interface AddToGroupDrawerProps {
  profileId: string;
  group: ExpenseGroup;
  memberIds: Set<string>;
  onClose: () => void;
  /** Keeps the rows (optimistically); resolves with what failed. */
  onAdd: (rows: Expense[]) => Promise<{ done: Expense[]; failed: Expense[] }>;
}

export function AddToGroupDrawer({ profileId, group, memberIds, onClose, onAdd }: AddToGroupDrawerProps) {
  const { t, language } = useLanguage();
  const ids = useId();
  const [side, setSide] = useState<Side>('before');
  const range = pickerWindow(group, side);
  const pool = usePickerPool(profileId, group.id, range);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState<{ done: number; total: number; failed: number } | null>(null);
  const hasAfter = pickerWindow(group, 'after') !== null;

  const rows = useMemo(() => (pool.data ?? []).filter((row) => !memberIds.has(row.id)), [pool.data, memberIds]);
  const chosen = rows.filter((row) => picked.has(row.id));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function add() {
    if (chosen.length === 0) return;
    setBusy(true);
    const result = await onAdd(chosen);
    setBusy(false);
    if (result.failed.length === 0) return;
    setPartial({ done: result.done.length, total: chosen.length, failed: result.failed.length });
    setPicked(new Set(result.failed.map((r) => r.id)));
  }

  const addLabel = busy ? t('hosted.groups.picker.adding') : chosen.length === 0 ? t('hosted.groups.picker.addNone') : t('hosted.groups.picker.add', { count: chosen.length });

  return (
    <Drawer
      title={t('hosted.groups.picker.title', { name: group.name })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void add()}>
            {partial ? t('hosted.groups.picker.retry', { count: chosen.length }) : addLabel}
          </Button>
        </div>
      }
    >
      <div className="hp-picker">
        {hasAfter && (
          <div role="group" aria-label={t('hosted.groups.picker.sides')}>
            <SegmentedTabs<Side>
              options={[
                { value: 'before', label: t('hosted.groups.picker.before') },
                { value: 'after', label: t('hosted.groups.picker.after') },
              ]}
              value={side}
              onChange={(next) => {
                setSide(next);
                setPicked(new Set());
                setPartial(null);
              }}
            />
          </div>
        )}
        {range && <p className="form-hint">{t('hosted.groups.picker.range', { from: formatDay(range.from, language), to: formatDay(range.to, language) })}</p>}
        {!hasAfter && <p className="form-hint">{t('hosted.groups.picker.afterHint')}</p>}
        {pool.isError ? (
          <Unreachable onRetry={() => void pool.refetch()} />
        ) : pool.isPending ? (
          <Skeleton rows={3} />
        ) : rows.length === 0 ? (
          <p className="hp-picker-empty">{t(side === 'before' ? 'hosted.groups.picker.emptyBefore' : 'hosted.groups.picker.emptyAfter')}</p>
        ) : (
          <ul className="hp-pick-list" aria-label={t('hosted.groups.picker.title', { name: group.name })}>
            {rows.map((row) => (
              <li key={row.id}>
                <label className="hp-pick" htmlFor={`${ids}-${row.id}`}>
                  <input id={`${ids}-${row.id}`} type="checkbox" checked={picked.has(row.id)} onChange={() => toggle(row.id)} disabled={busy} />
                  <span className="hp-pick-text">
                    {row.title || t('hosted.groups.detail.untitled')} · {formatDay(row.occurredOn, language)}
                  </span>
                  <DecimalAmount value={row.amount} currency={row.currency} />
                </label>
              </li>
            ))}
          </ul>
        )}
        {partial && (
          <p className="form-error" role="alert">
            {t('hosted.groups.picker.partial', partial)}
          </p>
        )}
      </div>
    </Drawer>
  );
}
