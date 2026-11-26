import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { api, ApiError, type Schemas, type TwoFactorChallenge } from '../api/client';
import { AlertIcon, InfoIcon } from '../components/Icons';
import { Drawer } from '../components/Drawer';
import { QueryView } from '../components/QueryView';
import { RadioCards } from '../components/RadioCards';
import { RowButton, RowGroup, RowNote } from '../components/YouRows';
import { useToast } from '../components/Toast';
import { SentenceWithEmail } from '../pages/auth/CheckEmailNotice';
import { CODE_LENGTH, codeDigits } from '../pages/auth/signInCode';
import { ME_KEY, useMe } from '../session/me';
import { TwoFactorFields } from './TwoFactorFields';
import { answerOf, EMPTY_TWO_FACTOR_INPUT, twoFactorFailure, type TwoFactorFailure, type TwoFactorInput, type TwoFactorMethod } from './twoFactor';

/**
 * You › Account › Two-step sign-in (MUT-710 D8, D9; wireframes "Turn on" and "Manage"): one drawer, in panes, as
 * Passkeys does. Off: choose the app (recommended) or email with the current password, prove the code arrives, save
 * the ten recovery codes (Done waits for the tick). On: the method and the codes left, then new codes, switching method
 * and turning it off, each confirmed with the password and the current second step. Turning it off is refused while a
 * profile the person owns issues documents or is connected to the Tax Authority (D10).
 *
 * It also opens over the issue drawer (`?twoFactor=true`), so the invoice being written isn't lost.
 */

export const TWO_FACTOR_KEY = ['two-factor'] as const;

type Enrolment = Schemas['TwoFactorEnrolment'];
type Action = 'renew' | 'switch' | 'off';
type Pane =
  | { kind: 'overview' }
  | { kind: 'prove'; enrolment: Enrolment }
  | { kind: 'codes'; codes: string[]; after: 'enabled' | 'renewed' }
  | { kind: 'confirm'; action: Action };
type Banner = { kind: 'wrongPassword' } | { kind: 'required' } | { kind: 'restart' } | TwoFactorFailure;

const FORM_ID = 'hosted-two-factor-form';

function bannerOf(error: unknown): Banner {
  if (error instanceof ApiError && error.code === 'CURRENT_PASSWORD_WRONG') return { kind: 'wrongPassword' };
  if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED_FOR_ISSUING') return { kind: 'required' };
  return twoFactorFailure(error);
}

export function TwoFactorDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: TWO_FACTOR_KEY, queryFn: ({ signal }) => api.twoFactorState(signal) });
  const [pane, setPane] = useState<Pane>({ kind: 'overview' });
  const [banner, setBanner] = useState<Banner | null>(null);

  function go(next: Pane, withBanner: Banner | null = null) {
    setBanner(withBanner);
    setPane(next);
  }

  /** The account changed: Me (You › Account's row, the issuing gate) and this drawer read it again. */
  function changed() {
    void queryClient.invalidateQueries({ queryKey: TWO_FACTOR_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  }

  if (pane.kind === 'prove') {
    return <ProvePane enrolment={pane.enrolment} banner={banner} setBanner={setBanner} onBack={() => go({ kind: 'overview' })} onRestart={() => go({ kind: 'overview' }, { kind: 'restart' })} onEnabled={(codes) => {
      changed();
      go({ kind: 'codes', codes, after: 'enabled' });
    }} onClose={onClose} />;
  }
  if (pane.kind === 'codes') return <CodesPane codes={pane.codes} after={pane.after} onDone={onClose} />;
  if (pane.kind === 'confirm' && state.data) {
    return (
      <ConfirmPane
        action={pane.action}
        method={state.data.method ?? 'totp'}
        banner={banner}
        setBanner={setBanner}
        onBack={() => go({ kind: 'overview' })}
        onClose={onClose}
        onRenewed={(codes) => {
          changed();
          go({ kind: 'codes', codes, after: 'renewed' });
        }}
        onSwitching={(enrolment) => go({ kind: 'prove', enrolment })}
        onOff={() => {
          changed();
          onClose();
        }}
      />
    );
  }

  if (state.data?.enabled) return <ManagePane state={state.data} banner={banner} onAction={(action) => go({ kind: 'confirm', action })} onClose={onClose} />;
  if (state.data) return <ChoosePane banner={banner} setBanner={setBanner} onStarted={(enrolment) => go({ kind: 'prove', enrolment })} onClose={onClose} />;
  return (
    <Drawer title={t('hosted.twoFactor.title')} onClose={onClose} closeLabel={t('common.close')}>
      <QueryView queries={[state]} data={state.data}>
        {() => null}
      </QueryView>
    </Drawer>
  );
}

function DrawerBanner({ banner, id }: { banner: Banner; id?: string }) {
  const t = useT();
  const tp = useTp();
  let text: ReactNode;
  switch (banner.kind) {
    case 'wrongPassword':
      text = t('hosted.account.changePassword.wrongCurrent');
      break;
    case 'required':
      text = t('hosted.twoFactor.requiredNote');
      break;
    case 'restart':
    case 'expired':
    case 'tooMany':
      text = t('hosted.twoFactor.startAgain');
      break;
    case 'wrong':
      text = tp('hosted.twoFactor.wrong', banner.triesLeft);
      break;
    case 'wait':
      text = tp('hosted.signInCode.wait', banner.minutes);
      break;
    case 'unreachable':
      text = t('hosted.auth.unreachable');
      break;
  }
  return (
    <div className="hp-banner hp-banner-error" role="alert" id={id}>
      <AlertIcon />
      <span>{text}</span>
    </div>
  );
}

/** The current password, when the person has one of their own (Me ownPassword; Malafat-made accounts may not, D8). */
function CurrentPassword({ value, onChange, disabled, describedBy }: { value: string; onChange: (next: string) => void; disabled: boolean; describedBy?: string }) {
  const t = useT();
  const ids = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={`${ids}-password`}>
        {t('hosted.account.changePassword.current')}
      </label>
      <div className="hp-password">
        <input
          id={`${ids}-password`}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          dir="ltr"
          readOnly={disabled}
          value={value}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="hp-password-toggle press" aria-pressed={shown} aria-controls={`${ids}-password`} onClick={() => setShown((s) => !s)}>
          {t(shown ? 'hosted.auth.hide' : 'hosted.auth.show')}
        </button>
      </div>
    </div>
  );
}

interface FormPaneProps {
  banner: Banner | null;
  setBanner: (banner: Banner | null) => void;
  onClose: () => void;
}

/** Off: pick where the code comes from; the password proves it's the person (D8). */
function ChoosePane({ banner, setBanner, onStarted, onClose }: FormPaneProps & { onStarted: (enrolment: Enrolment) => void }) {
  const t = useT();
  const ids = useId();
  const ownPassword = useMe().user.ownPassword !== false;
  const [method, setMethod] = useState<TwoFactorMethod>('totp');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setBanner(null);
    setPending(true);
    try {
      onStarted(await api.startTwoFactorEnrolment(ownPassword ? { method, currentPassword: password } : { method }));
    } catch (error) {
      setBanner(bannerOf(error));
      setPending(false);
    }
  }

  return (
    <Drawer
      title={t('hosted.twoFactor.chooseTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} aria-disabled={pending || undefined}>
            {t('hosted.twoFactor.next')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={onSubmit}>
        {banner && <DrawerBanner banner={banner} id={`${ids}-banner`} />}
        <p className="hp-muted hp-two-factor-lead" id={`${ids}-lead`}>
          {t('hosted.twoFactor.chooseLede')}
        </p>
        <RadioCards
          name={`${ids}-method`}
          labelledBy={`${ids}-lead`}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'totp', label: t('hosted.twoFactor.method.totp'), note: t('hosted.twoFactor.appNote') },
            { value: 'email', label: t('hosted.twoFactor.method.email') },
          ]}
        />
        {ownPassword && <CurrentPassword value={password} onChange={setPassword} disabled={pending} describedBy={banner ? `${ids}-banner` : undefined} />}
      </form>
    </Drawer>
  );
}

/** Prove the new factor works (D8): the app's QR code and key, or the code mailed to check it arrives. */
function ProvePane({ enrolment, banner, setBanner, onBack, onRestart, onEnabled, onClose }: FormPaneProps & { enrolment: Enrolment; onBack: () => void; onRestart: () => void; onEnabled: (codes: string[]) => void }) {
  const t = useT();
  const ids = useId();
  const showToast = useToast();
  const [code, setCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const app = enrolment.method === 'totp';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (code.length !== CODE_LENGTH || (enrolment.emailCodeRequired && emailCode.length !== CODE_LENGTH)) return setMissing(true);
    setMissing(false);
    setBanner(null);
    setPending(true);
    try {
      const { recoveryCodes } = await api.confirmTwoFactorEnrolment({ enrolmentToken: enrolment.enrolmentToken, code, ...(enrolment.emailCodeRequired ? { emailCode } : {}) });
      onEnabled(recoveryCodes);
    } catch (error) {
      const refused = bannerOf(error);
      setPending(false);
      // Ten minutes passed, or five wrong codes: the enrolment is gone, so it starts again from the choice.
      if (refused.kind === 'expired' || refused.kind === 'tooMany') return onRestart();
      setBanner(refused);
      setCode('');
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(enrolment.secret ?? '');
      showToast(t('hosted.twoFactor.keyCopied'), { tone: 'info' });
    } catch {
      showToast(t('hosted.twoFactor.copyFailed'), { tone: 'error' });
    }
  }

  const describedBy = banner ? `${ids}-banner` : undefined;
  return (
    <Drawer
      title={t(app ? 'hosted.twoFactor.method.totp' : 'hosted.twoFactor.method.email')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onBack}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} aria-disabled={pending || undefined}>
            {t('hosted.twoFactor.turnOn')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={onSubmit}>
        {banner && <DrawerBanner banner={banner} id={`${ids}-banner`} />}
        {app ? (
          <div className="hp-two-factor-qr">
            {enrolment.qrSvg && <img src={`data:image/svg+xml;utf8,${encodeURIComponent(enrolment.qrSvg)}`} alt={t('hosted.twoFactor.qrAlt')} width={168} height={168} />}
            <div className="hp-two-factor-key">
              <p className="hp-muted hp-two-factor-lead">{t('hosted.twoFactor.scan')}</p>
              <span className="form-hint">{t('hosted.twoFactor.orKey')}</span>
              <code className="hp-two-factor-secret" dir="ltr">
                {(enrolment.secret ?? '').replace(/(.{4})/g, '$1 ').trim()}
              </code>
              <button type="button" className="hp-link-button press" onClick={() => void copyKey()}>
                {t('hosted.twoFactor.copyKey')}
              </button>
              {enrolment.otpauthUri && (
                <a className="hp-two-factor-open" href={enrolment.otpauthUri}>
                  {t('hosted.twoFactor.openApp')}
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="hp-banner hp-banner-info" role="status">
            <InfoIcon />
            <span>
              <SentenceWithEmail sentence={t('hosted.twoFactor.emailSent')} email={enrolment.emailHint ?? ''} />
            </span>
          </div>
        )}
        <CodeInput label={t(app ? 'hosted.twoFactor.appCodeLabel' : 'hosted.twoFactor.code')} value={code} onChange={setCode} missing={missing && code.length !== CODE_LENGTH} invalid={banner?.kind === 'wrong'} disabled={pending} describedBy={describedBy} />
        {enrolment.emailCodeRequired && (
          <>
            <p className="form-hint">
              <SentenceWithEmail sentence={t('hosted.twoFactor.emailSent')} email={enrolment.emailHint ?? ''} />
            </p>
            <CodeInput label={t('hosted.twoFactor.emailCodeLabel')} value={emailCode} onChange={setEmailCode} missing={missing && emailCode.length !== CODE_LENGTH} disabled={pending} autoFocus={false} />
          </>
        )}
      </form>
    </Drawer>
  );
}

function CodeInput({ label, value, onChange, missing, invalid, disabled, describedBy, autoFocus = true }: { label: string; value: string; onChange: (next: string) => void; missing: boolean; invalid?: boolean; disabled: boolean; describedBy?: string; autoFocus?: boolean }) {
  const t = useT();
  const ids = useId();
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={`${ids}-code`}>
        {label}
      </label>
      <input
        id={`${ids}-code`}
        className={`input hp-ltr-input hp-code-input ${missing || invalid ? 'input-error' : ''}`}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        dir="ltr"
        spellCheck={false}
        autoFocus={autoFocus}
        readOnly={disabled}
        value={value}
        aria-invalid={missing || invalid}
        aria-describedby={[missing ? `${ids}-error` : null, describedBy ?? null].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(codeDigits(e.target.value))}
      />
      {missing && (
        <p className="form-error" id={`${ids}-error`}>
          {t('hosted.twoFactor.codeRequired')}
        </p>
      )}
    </div>
  );
}

/** Shown once (D9): each code lets the person in once. Done waits for "I've saved these codes". */
function CodesPane({ codes, after, onDone }: { codes: string[]; after: 'enabled' | 'renewed'; onDone: () => void }) {
  const t = useT();
  const showToast = useToast();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('hosted.twoFactor.codesCopied'), { tone: 'info' });
    } catch {
      showToast(t('hosted.twoFactor.copyFailed'), { tone: 'error' });
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`MTB3A\n${t('hosted.twoFactor.codesTitle')}\n\n${text}\n`], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mtb3a-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  function done() {
    if (!saved) return;
    showToast(t(after === 'enabled' ? 'hosted.twoFactor.onToast' : 'hosted.twoFactor.renewedToast'), { tone: 'info' });
    onDone();
  }

  return (
    <Drawer
      title={t('hosted.twoFactor.codesTitle')}
      // Closing before the tick would lose codes shown only now: the close button is Done's, and waits the same.
      onClose={done}
      closeLabel={t('hosted.twoFactor.done')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" onClick={done} aria-disabled={!saved || undefined}>
            {t('hosted.twoFactor.done')}
          </Button>
        </div>
      }
    >
      <p className="hp-muted hp-two-factor-lead">{t('hosted.twoFactor.codesLede')}</p>
      <ul className="hp-two-factor-codes" dir="ltr" aria-label={t('hosted.twoFactor.codesTitle')}>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="hp-two-factor-actions">
        <Button type="button" variant="secondary" onClick={() => void copyAll()}>
          {t('hosted.twoFactor.copyAll')}
        </Button>
        <Button type="button" variant="secondary" onClick={download}>
          {t('hosted.twoFactor.download')}
        </Button>
      </div>
      <label className="hp-check-row">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t('hosted.twoFactor.saved')}</span>
      </label>
    </Drawer>
  );
}

/** On: the method and the codes left, then the three changes (D8, D9). */
function ManagePane({ state, banner, onAction, onClose }: { state: Schemas['TwoFactorState']; banner: Banner | null; onAction: (action: Action) => void; onClose: () => void }) {
  const t = useT();
  const tp = useTp();
  const app = state.method === 'totp';
  return (
    <Drawer title={t('hosted.twoFactor.title')} onClose={onClose} closeLabel={t('common.close')}>
      {banner && <DrawerBanner banner={banner} />}
      <RowGroup>
        <RowNote label={<><b>{t('hosted.twoFactor.secondStep')}</b> · {t(app ? 'hosted.twoFactor.method.totp' : 'hosted.twoFactor.method.email')}</>} />
        <RowNote label={<><b>{t('hosted.twoFactor.codesLeftLabel')}</b> · {tp('hosted.twoFactor.codesLeft', state.recoveryCodesLeft)}</>} />
      </RowGroup>
      <RowGroup>
        <RowButton label={t('hosted.twoFactor.renew')} onClick={() => onAction('renew')} />
        <RowButton label={t(app ? 'hosted.twoFactor.switchToEmail' : 'hosted.twoFactor.switchToApp')} onClick={() => onAction('switch')} />
        {state.requiredForIssuing ? (
          <RowButton tone="danger" inert label={t('hosted.twoFactor.turnOff')} sub={t('hosted.twoFactor.requiredNote')} onClick={() => undefined} />
        ) : (
          <RowButton tone="danger" label={t('hosted.twoFactor.turnOff')} onClick={() => onAction('off')} />
        )}
      </RowGroup>
    </Drawer>
  );
}

/** Each change needs the password and the current second step (D8): the challenge is asked for once, on opening. */
function ConfirmPane({ action, method, banner, setBanner, onBack, onClose, onRenewed, onSwitching, onOff }: FormPaneProps & { action: Action; method: TwoFactorMethod; onBack: () => void; onRenewed: (codes: string[]) => void; onSwitching: (enrolment: Enrolment) => void; onOff: () => void }) {
  const t = useT();
  const ids = useId();
  const showToast = useToast();
  const ownPassword = useMe().user.ownPassword !== false;
  const challenge = useQuery({ queryKey: [...TWO_FACTOR_KEY, 'challenge', action], queryFn: () => api.twoFactorChallenge(), staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  const [password, setPassword] = useState('');
  const [input, setInput] = useState<TwoFactorInput>(EMPTY_TWO_FACTOR_INPUT);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);

  async function send(current: TwoFactorChallenge) {
    const answer = answerOf(input);
    if (!answer) return setMissing(true);
    setMissing(false);
    setBanner(null);
    setPending(true);
    const proof = { ...(ownPassword ? { currentPassword: password } : {}), challengeToken: current.challengeToken, ...answer };
    try {
      if (action === 'renew') return onRenewed((await api.renewRecoveryCodes(proof)).recoveryCodes);
      if (action === 'switch') return onSwitching(await api.startTwoFactorEnrolment({ method: method === 'totp' ? 'email' : 'totp', ...proof }));
      await api.turnOffTwoFactor(proof);
      showToast(t('hosted.twoFactor.offToast'), { tone: 'info' });
      onOff();
    } catch (error) {
      const refused = bannerOf(error);
      setPending(false);
      setBanner(refused);
      setInput((now) => ({ ...now, code: '', recoveryCode: '' }));
      // The challenge is spent: ask for a new one (the email method mails it).
      if (refused.kind === 'expired' || refused.kind === 'tooMany') void challenge.refetch();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pending && challenge.data) void send(challenge.data);
  }

  const title = action === 'renew' ? 'hosted.twoFactor.renew' : action === 'switch' ? (method === 'totp' ? 'hosted.twoFactor.switchToEmail' : 'hosted.twoFactor.switchToApp') : 'hosted.twoFactor.turnOff';
  return (
    <Drawer
      title={t(title)}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onBack}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} variant={action === 'off' ? 'danger' : 'primary'} aria-disabled={pending || !challenge.data || undefined}>
            {t(action === 'off' ? 'hosted.twoFactor.turnOff' : 'hosted.twoFactor.next')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={onSubmit}>
        {banner && <DrawerBanner banner={banner} id={`${ids}-banner`} />}
        <p className="hp-muted hp-two-factor-lead">{t(action === 'off' ? 'hosted.twoFactor.offConfirm' : 'hosted.twoFactor.confirmLede')}</p>
        {ownPassword && <CurrentPassword value={password} onChange={setPassword} disabled={pending} describedBy={banner ? `${ids}-banner` : undefined} />}
        {challenge.data ? (
          <TwoFactorFields
            key={challenge.data.challengeToken}
            challenge={challenge.data}
            value={input}
            onChange={(next) => {
              setInput(next);
              setMissing(false);
            }}
            codeLabel={t(challenge.data.method === 'totp' ? 'hosted.twoFactor.confirmCode' : 'hosted.twoFactor.code')}
            missing={missing}
            invalid={banner?.kind === 'wrong'}
            disabled={pending}
            describedBy={banner ? `${ids}-banner` : undefined}
            autoFocus={!ownPassword}
          />
        ) : challenge.isError ? (
          <DrawerBanner banner={twoFactorFailure(challenge.error)} />
        ) : (
          <p className="hp-muted hp-two-factor-lead" role="status">
            {t('common.loading')}
          </p>
        )}
      </form>
    </Drawer>
  );
}
