import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { api, ApiError, type Passkey, type Schemas } from '../api/client';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { addPasskeyFlow, PASSKEYS_KEY, passkeysChanged } from '../passkeys/addPasskey';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { QueryView } from './QueryView';
import { useToast } from './Toast';

/**
 * You › Account › Passkeys (MUT-115, DR2–DR7, DR11). The list (name, added, last used), Add a passkey, inline rename,
 * and an in-row Remove confirm (no window.confirm). Adding tries first; only a 403 RECENT_SIGN_IN_REQUIRED asks for the
 * password (DR6), and a wrong one counts toward the sign-in lockout like any other. Cancelling the system sheet shows
 * nothing. Names are the server's (provider or device, DR8), shown with dir="auto".
 *
 * MUT-370's seam: `addPasskeyFlow` (passkeys/addPasskey.ts) is the whole "add" ceremony with its outcomes, so the "suggest a passkey"
 * card after first sign-in can run the same flow without this drawer.
 *
 * MUT-415: `review` opens it as the step after a password change or a recovery: the intro says these passkeys still
 * sign in and to remove any the person doesn't recognise, and Done takes Add's place. The list is the same.
 */
const FORM_ID = 'hosted-passkeys-step-up';
const NAME_MAX = 64;

type Banner = 'addFailed' | 'wrongPassword' | 'renameFailed' | 'removeFailed' | 'unreachable' | 'operatorPasskeyFirst';

export function PasskeysDrawer({ onClose, review }: { onClose: () => void; review?: 'password' | 'recovery' | undefined }) {
  const t = useT();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const ids = useId();
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: ({ signal }) => api.listPasskeys(signal) });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adding, setAdding] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const limit = passkeys.data?.limit ?? 10;
  const atLimit = (passkeys.data?.items.length ?? 0) >= limit;

  useEffect(() => {
    if (stepUp) passwordRef.current?.focus();
  }, [stepUp]);

  async function add(event?: FormEvent) {
    event?.preventDefault();
    if (adding || atLimit) return;
    setBanner(null);
    setAdding(true);
    const outcome = await addPasskeyFlow(stepUp ? password : undefined);
    setAdding(false);
    switch (outcome.kind) {
      case 'added':
        setStepUp(false);
        setPassword('');
        queryClient.setQueryData<Schemas['PasskeyList']>(PASSKEYS_KEY, (list) => (list ? { ...list, items: [...list.items, outcome.passkey] } : list));
        void passkeysChanged(queryClient);
        setFocusId(outcome.passkey.id);
        showToast(t('hosted.account.passkeys.added'), { tone: 'info' });
        return;
      case 'cancelled':
        return;
      case 'stepUp':
        setStepUp(true);
        return;
      case 'operatorPasskeyFirst':
        setBanner('operatorPasskeyFirst');
        return;
      case 'wrongPassword':
        setBanner('wrongPassword');
        setPassword('');
        passwordRef.current?.focus();
        return;
      case 'limit':
        void queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
        return;
      case 'unreachable':
        setBanner('unreachable');
        return;
      case 'failed':
        setBanner('addFailed');
    }
  }

  const bannerId = `${ids}-banner`;
  const addLabel = stepUp ? t('hosted.account.passkeys.continue') : t('hosted.account.passkeys.add');

  return (
    <Drawer
      title={t('hosted.account.passkeys.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        review ? (
          <div className="drawer-footer-right">
            <Button ref={addRef} type="button" onClick={onClose}>
              {t('hosted.account.passkeys.done')}
            </Button>
          </div>
        ) : (
          <div className="drawer-footer-right">
            {atLimit && <p className="form-hint hp-passkey-limit">{t('hosted.account.passkeys.limit', { limit })}</p>}
            <Button ref={addRef} type={stepUp ? 'submit' : 'button'} form={stepUp ? FORM_ID : undefined} onClick={stepUp ? undefined : () => void add()} disabled={atLimit} aria-disabled={adding || undefined} aria-busy={adding}>
              {addLabel}
            </Button>
          </div>
        )
      }
    >
      <p className="hp-muted hp-passkey-intro">{t(review ? `hosted.account.passkeys.review.${review}` : 'hosted.account.passkeys.intro')}</p>
      {banner && (
        <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
          <AlertIcon />
          <span>{t(BANNER_KEYS[banner])}</span>
        </div>
      )}
      <QueryView
        queries={[passkeys]}
        data={passkeys.data}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <div className="hp-passkey-empty">
            <h3>{t('hosted.account.passkeys.emptyTitle')}</h3>
            <p className="hp-muted">{t('hosted.account.passkeys.emptyBody')}</p>
          </div>
        }
      >
        {(data) => (
          <ul className="hp-passkey-list">
            {data.items.map((passkey, index) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                focus={focusId === passkey.id}
                onFocused={() => setFocusId(null)}
                onBanner={setBanner}
                onRemoved={() => {
                  const next = data.items[index + 1] ?? data.items[index - 1];
                  if (next) setFocusId(next.id);
                  else addRef.current?.focus();
                }}
              />
            ))}
          </ul>
        )}
      </QueryView>
      {stepUp && (
        <form id={FORM_ID} noValidate onSubmit={(e) => void add(e)} className="hp-passkey-stepup">
          <p>{t('hosted.account.passkeys.stepUp')}</p>
          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-password`}>
              {t('hosted.auth.password')}
            </label>
            <div className="hp-password">
              <input
                ref={passwordRef}
                id={`${ids}-password`}
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                dir="ltr"
                readOnly={adding}
                value={password}
                aria-describedby={banner ? bannerId : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="hp-password-toggle press" aria-pressed={showPassword} aria-controls={`${ids}-password`} onClick={() => setShowPassword((shown) => !shown)}>
                {t(showPassword ? 'hosted.auth.hide' : 'hosted.auth.show')}
              </button>
            </div>
          </div>
        </form>
      )}
    </Drawer>
  );
}

const BANNER_KEYS: Record<Banner, string> = {
  addFailed: 'hosted.account.passkeys.addFailed',
  wrongPassword: 'hosted.account.changePassword.wrongCurrent',
  renameFailed: 'hosted.account.passkeys.renameFailed',
  removeFailed: 'hosted.account.passkeys.removeFailed',
  unreachable: 'hosted.auth.unreachable',
  // MUT-459: an operator confirms with an existing passkey, never the password (ADR-208).
  operatorPasskeyFirst: 'hosted.account.passkeys.operatorPasskeyFirst',
};

type RowMode = 'view' | 'rename' | 'confirm';

function PasskeyRow({
  passkey,
  focus,
  onFocused,
  onBanner,
  onRemoved,
}: {
  passkey: Passkey;
  focus: boolean;
  onFocused: () => void;
  onBanner: (banner: Banner | null) => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const ids = useId();
  const [mode, setMode] = useState<RowMode>('view');
  const [name, setName] = useState(passkey.name);
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focus) return;
    rowRef.current?.focus();
    onFocused();
  }, [focus, onFocused]);
  useEffect(() => {
    if (mode === 'confirm') cancelRef.current?.focus();
    if (mode === 'rename') nameRef.current?.focus();
  }, [mode]);

  const meta = metaLine(passkey, language, t);

  function cancel() {
    setMode('view');
    setName(passkey.name);
    setNameError(false);
    // DR11: cancelling the confirm returns to that row's Remove.
    requestAnimationFrame(() => removeRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && mode !== 'view') {
      // Escape inside the confirm (or rename) cancels it before it can close the drawer.
      event.stopPropagation();
      cancel();
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setNameError(true);
      return;
    }
    setBusy(true);
    onBanner(null);
    try {
      await api.renamePasskey(passkey.id, trimmed);
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
      setMode('view');
      showToast(t('hosted.account.passkeys.renamed'), { tone: 'info' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setNameError(true);
      else onBanner('renameFailed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    onBanner(null);
    try {
      await api.removePasskey(passkey.id);
      onRemoved();
      await passkeysChanged(queryClient);
      showToast(t('hosted.account.passkeys.removed'), { tone: 'info' });
    } catch {
      onBanner('removeFailed');
      setBusy(false);
    }
  }

  return (
    <li ref={rowRef} className="hp-passkey-row" tabIndex={-1} aria-label={t('hosted.account.passkeys.rowLabel', { name: passkey.name, meta })} onKeyDown={onKeyDown}>
      {mode === 'rename' ? (
        <form className="hp-passkey-rename" noValidate onSubmit={(e) => void saveName(e)}>
          <label className="form-label" htmlFor={`${ids}-name`}>
            {t('hosted.account.passkeys.nameLabel')}
          </label>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            className={`input ${nameError ? 'input-error' : ''}`}
            dir="auto"
            maxLength={NAME_MAX + 8}
            value={name}
            readOnly={busy}
            aria-invalid={nameError}
            aria-describedby={nameError ? `${ids}-name-error` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {nameError && (
            <p className="form-error" id={`${ids}-name-error`}>
              {t('hosted.account.passkeys.nameInvalid', { max: NAME_MAX })}
            </p>
          )}
          <div className="hp-passkey-actions">
            <Button type="button" variant="secondary" size="sm" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" aria-busy={busy} aria-disabled={busy || undefined}>
              {t('hosted.account.passkeys.save')}
            </Button>
          </div>
        </form>
      ) : mode === 'confirm' ? (
        <div className="hp-passkey-confirm" role="group" aria-labelledby={`${ids}-confirm`}>
          <p id={`${ids}-confirm`}>{t('hosted.account.passkeys.confirm', { name: passkey.name })}</p>
          <div className="hp-passkey-actions">
            <Button ref={cancelRef} type="button" variant="secondary" size="sm" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="danger" size="sm" aria-busy={busy} disabled={busy} onClick={() => void remove()}>
              {t('hosted.account.passkeys.remove')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span className="hp-passkey-text">
            <span className="hp-passkey-name" dir="auto">
              {passkey.name}
            </span>
            <span className="hp-option-sub">{meta}</span>
          </span>
          <span className="hp-passkey-actions">
            <button type="button" className="hp-link-button press" aria-label={t('hosted.account.passkeys.renameLabel', { name: passkey.name })} onClick={() => setMode('rename')}>
              {t('hosted.account.passkeys.rename')}
            </button>
            <button
              ref={removeRef}
              type="button"
              className="hp-link-button hp-danger press"
              aria-label={t('hosted.account.passkeys.removeLabel', { name: passkey.name })}
              onClick={() => setMode('confirm')}
            >
              {t('hosted.account.passkeys.remove')}
            </button>
          </span>
        </>
      )}
    </li>
  );
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function metaLine(passkey: Passkey, language: Language, t: ReturnType<typeof useT>): string {
  const zone = browserTimezone();
  const added = t('hosted.account.passkeys.addedOn', { date: formatInstant(passkey.createdAt, language, zone) });
  if (!passkey.lastUsedAt) return `${added} · ${t('hosted.account.passkeys.neverUsed')}`;
  const used = new Date(passkey.lastUsedAt);
  const when = sameLocalDay(used, new Date()) ? t('hosted.account.passkeys.today') : formatInstant(passkey.lastUsedAt, language, zone);
  return `${added} · ${t('hosted.account.passkeys.lastUsed', { when })}`;
}
