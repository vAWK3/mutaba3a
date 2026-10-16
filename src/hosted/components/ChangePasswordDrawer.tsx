import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { api, ApiError } from '../api/client';
import { NEW_PASSWORD_POLICY, passwordProblem, type PasswordProblem } from '../pages/auth/setupLink';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { useToast } from './Toast';

/**
 * Change your own password (MUT-237), from the account menu. Reuses the
 * setup page's password rule and field shape (`setupLink.ts`): a visible
 * hint, inline refusal before anything is sent, no confirm field. A wrong
 * current password is a banner, not a field error — it isn't this field
 * that's invalid, the account doesn't recognise it.
 */

const POLICY_VARS = { min: NEW_PASSWORD_POLICY.minLength, max: NEW_PASSWORD_POLICY.maxLength };
const FORM_ID = 'hosted-change-password-form';

type FieldError = PasswordProblem;
type Banner = { kind: 'wrongCurrent' } | { kind: 'unreachable' };

export function ChangePasswordDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const showToast = useToast();
  const currentRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = passwordProblem(newPassword);
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    setBanner(null);
    setPending(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      showToast(t('hosted.account.changePassword.success'), { tone: 'info' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CURRENT_PASSWORD_WRONG') {
        setBanner({ kind: 'wrongCurrent' });
        currentRef.current?.focus();
      } else if (error instanceof ApiError && error.status === 422) {
        setFieldError('tooShort');
      } else {
        setBanner({ kind: 'unreachable' });
      }
    } finally {
      setPending(false);
    }
  }

  const bannerId = `${ids}-banner`;
  const ruleId = `${ids}-rule`;
  const errorId = `${ids}-error`;

  return (
    <Drawer
      title={t('hosted.account.changePassword.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} aria-disabled={pending || undefined}>
            {pending ? t('hosted.account.changePassword.saving') : t('hosted.account.changePassword.submit')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={onSubmit}>
        {banner && (
          <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
            <AlertIcon />
            <span>{t(banner.kind === 'wrongCurrent' ? 'hosted.account.changePassword.wrongCurrent' : 'hosted.auth.unreachable')}</span>
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-current`}>
            {t('hosted.account.changePassword.current')}
          </label>
          <input
            ref={currentRef}
            id={`${ids}-current`}
            className="input"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            autoFocus
            readOnly={pending}
            value={currentPassword}
            aria-describedby={banner ? bannerId : undefined}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-new`}>
            {t('hosted.account.changePassword.new')}
          </label>
          <input
            id={`${ids}-new`}
            className={`input ${fieldError ? 'input-error' : ''}`}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            readOnly={pending}
            value={newPassword}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={[ruleId, fieldError ? errorId : null].filter(Boolean).join(' ')}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className="form-hint" id={ruleId}>
            {t('hosted.setup.rule', POLICY_VARS)}
          </p>
          {fieldError && (
            <p className="form-error" id={errorId}>
              {t(`hosted.setup.${fieldError}`, POLICY_VARS)}
            </p>
          )}
        </div>
      </form>
    </Drawer>
  );
}
