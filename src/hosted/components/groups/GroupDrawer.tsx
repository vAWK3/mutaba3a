import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { ApiError, apiErrorBound, apiErrorReason, type CreateExpenseGroupRequest, type ExpenseGroup, type UpdateExpenseGroupRequest } from '../../api/client';
import { useAttemptKey } from '../../data/attemptKey';
import { maxEndOn } from '../../data/expenseGroups';
import { groupsKey, useCreateGroup, useDeleteGroup, useUpdateGroup } from '../../data/expenseGroupQueries';
import { formatDay } from '../../format/dates';
import { Drawer } from '../Drawer';

/**
 * New group / Edit group (MUT-268 9A, 10A, 14A): name, From (today by default),
 * To (required unless "Still going", capped at From + 365), notes. Edit adds
 * the re-check hint and Delete, confirmed in place with the member count.
 */

type Field = 'name' | 'startOn' | 'endOn' | 'form';
type Errors = Partial<Record<Field, string>>;

interface Values {
  name: string;
  startOn: string;
  endOn: string;
  stillGoing: boolean;
  notes: string;
}

function valuesOf(group: ExpenseGroup | undefined, today: string): Values {
  if (!group) return { name: '', startOn: today, endOn: '', stillGoing: false, notes: '' };
  return { name: group.name, startOn: group.startOn, endOn: group.endOn ?? '', stillGoing: group.endOn === null, notes: group.notes ?? '' };
}

export interface GroupDrawerProps {
  profileId: string;
  /** The profile's today, `YYYY-MM-DD`: the default From. */
  today: string;
  /** Present when editing. */
  group?: ExpenseGroup;
  onClose: () => void;
  onCreated?: (group: ExpenseGroup) => void;
  onSaved?: (group: ExpenseGroup) => void;
  onDeleted?: (group: ExpenseGroup) => void;
}

export function GroupDrawer({ profileId, today, group, onClose, onCreated, onSaved, onDeleted }: GroupDrawerProps) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const queryClient = useQueryClient();
  const ids = useId();
  const attempt = useAttemptKey();
  const create = useCreateGroup(profileId);
  const update = useUpdateGroup(profileId);
  const remove = useDeleteGroup(profileId);
  const [values, setValues] = useState<Values>(() => valuesOf(group, today));
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);

  // A newer version arrived (after a 409, eng E11): refill from it, keeping the conflict note.
  const [seenVersion, setSeenVersion] = useState(group?.version);
  if (group && group.version !== seenVersion) {
    setSeenVersion(group.version);
    setValues(valuesOf(group, today));
  }

  const editing = Boolean(group);
  const lastEnd = values.startOn ? maxEndOn(values.startOn) : undefined;
  const set = (change: Partial<Values>) => setValues((current) => ({ ...current, ...change }));
  const e = (key: string, vars?: Record<string, string | number>) => t(`hosted.groups.drawer.errors.${key}`, vars);

  function check(): Errors {
    const found: Errors = {};
    if (!values.name.trim()) found.name = e('nameRequired');
    if (!values.startOn) found.startOn = e('startRequired');
    if (!values.stillGoing && !values.endOn) found.endOn = e('endRequired');
    else if (!values.stillGoing && values.endOn < values.startOn) found.endOn = e('endBeforeStart');
    else if (!values.stillGoing && lastEnd && values.endOn > lastEnd) found.endOn = e('tooLong', { date: formatDay(lastEnd, language) });
    return found;
  }

  function apiErrors(error: unknown): Errors {
    if (!(error instanceof ApiError)) return { form: e('network') };
    if (error.code === 'CONFLICT') return { form: e('conflict') };
    if (error.code === 'NOT_FOUND') return { form: e('notFound') };
    if (error.code === 'NETWORK' || error.status >= 500) return { form: e('network') };
    const field = (error.details as { field?: unknown } | null)?.field;
    const at: Field = field === 'startOn' || field === 'endOn' ? field : 'endOn';
    switch (apiErrorReason(error)) {
      case 'NAME_REQUIRED':
        return { name: e('nameRequired') };
      case 'END_BEFORE_START':
        return { endOn: e('endBeforeStart') };
      case 'GROUP_RANGE_TOO_LONG':
        return { endOn: e('tooLong', { date: lastEnd ? formatDay(lastEnd, language) : '' }) };
      case 'DATE_INVALID':
        return { [at]: e(apiErrorBound(error) === 'future' ? 'dateTooFar' : 'dateTooOld') };
      case 'GROUP_LIMIT':
        return { form: e('limit') };
      default:
        return { form: e('invalid') };
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const name = values.name.trim();
    const endOn = values.stillGoing ? null : values.endOn;
    try {
      if (group) {
        const body: UpdateExpenseGroupRequest = { name, startOn: values.startOn, endOn, notes: values.notes.trim() || null };
        onSaved?.(await update.mutateAsync({ groupId: group.id, body, version: group.version }));
      } else {
        const body: CreateExpenseGroupRequest = { name, startOn: values.startOn, ...(endOn ? { endOn } : {}), ...(values.notes.trim() ? { notes: values.notes.trim() } : {}) };
        const created = await create.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
        attempt.succeeded();
        onCreated?.(created);
      }
    } catch (error) {
      // A refusal ends the attempt (TD-163): the same body sent again must not replay the cached 422.
      if (error instanceof ApiError && error.status === 422) attempt.succeeded();
      if (group && error instanceof ApiError && error.code === 'CONFLICT') void queryClient.invalidateQueries({ queryKey: groupsKey(profileId, 'group', group.id) });
      setErrors(apiErrors(error));
    }
  }

  async function confirmDelete() {
    if (!group) return;
    try {
      await remove.mutateAsync(group.id);
      onDeleted?.(group);
    } catch (error) {
      setConfirming(false);
      setErrors(apiErrors(error));
    }
  }

  const busy = create.isPending || update.isPending;
  const fieldError = (field: Field) =>
    errors[field] && (
      <p className="form-error" id={`${ids}-${field}-error`}>
        {errors[field]}
      </p>
    );
  const describedBy = (field: Field, hint?: string) => [errors[field] && `${ids}-${field}-error`, hint].filter(Boolean).join(' ') || undefined;

  return (
    <Drawer
      title={t(editing ? 'hosted.groups.drawer.editTitle' : 'hosted.groups.drawer.newTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={busy}>
            {editing ? t(busy ? 'common.saving' : 'common.save') : t(busy ? 'hosted.groups.drawer.creating' : 'hosted.groups.drawer.create')}
          </Button>
        </div>
      }
    >
      <form id={`${ids}-form`} className="hp-group-form" onSubmit={(event) => void submit(event)} noValidate>
        {errors.form && (
          <div className="hp-banner hp-banner-error" role="alert">
            {errors.form}
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-name`}>
            {t('hosted.groups.drawer.name')}
          </label>
          <input
            id={`${ids}-name`}
            className="input"
            value={values.name}
            maxLength={120}
            placeholder={t('hosted.groups.drawer.namePlaceholder')}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
            onChange={(event) => set({ name: event.target.value })}
          />
          {fieldError('name')}
        </div>
        <div className="hp-group-dates">
          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-from`}>
              {t('hosted.groups.drawer.from')}
            </label>
            <input
              id={`${ids}-from`}
              type="date"
              className="input"
              value={values.startOn}
              aria-invalid={Boolean(errors.startOn)}
              aria-describedby={describedBy('startOn')}
              onChange={(event) => set({ startOn: event.target.value })}
            />
            {fieldError('startOn')}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-to`}>
              {t('hosted.groups.drawer.to')}
            </label>
            <input
              id={`${ids}-to`}
              type="date"
              className="input"
              value={values.stillGoing ? '' : values.endOn}
              min={values.startOn}
              max={lastEnd}
              disabled={values.stillGoing}
              aria-invalid={Boolean(errors.endOn)}
              aria-describedby={describedBy('endOn', `${ids}-to-hint`)}
              onChange={(event) => set({ endOn: event.target.value })}
            />
            {lastEnd && (
              <p className="form-hint" id={`${ids}-to-hint`}>
                {t('hosted.groups.drawer.maxEnd', { date: formatDay(lastEnd, language) })}
              </p>
            )}
            {fieldError('endOn')}
          </div>
        </div>
        <label className="hp-check-row">
          <input type="checkbox" checked={values.stillGoing} onChange={(event) => set({ stillGoing: event.target.checked })} />
          {t('hosted.groups.drawer.stillGoing')}
        </label>
        <p className="form-hint">{t(editing ? 'hosted.groups.drawer.editHint' : 'hosted.groups.drawer.autoJoin')}</p>
        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-notes`}>
            {t('hosted.groups.drawer.notes')} <span className="hp-muted">{t('hosted.groups.drawer.optional')}</span>
          </label>
          <textarea id={`${ids}-notes`} className="input" rows={2} value={values.notes} onChange={(event) => set({ notes: event.target.value })} />
        </div>
      </form>
      {group &&
        (confirming ? (
          <div className="hp-confirm" role="group" aria-labelledby={`${ids}-confirm`}>
            <h3 id={`${ids}-confirm`}>{t('hosted.groups.drawer.confirmTitle', { name: group.name })}</h3>
            <p>{group.memberCount === 0 ? t('hosted.groups.drawer.confirmEmpty') : tp('hosted.groups.drawer.confirmBody', group.memberCount)}</p>
            <div className="hp-empty-actions">
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                {t('hosted.groups.drawer.keep')}
              </Button>
              <Button type="button" variant="danger" disabled={remove.isPending} onClick={() => void confirmDelete()}>
                {t('hosted.groups.drawer.delete')}
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="hp-link-button hp-danger press" onClick={() => setConfirming(true)}>
            {t('hosted.groups.drawer.delete')}
          </button>
        ))}
    </Drawer>
  );
}
