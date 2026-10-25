import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { copyToClipboard } from '../../lib/utils';

/**
 * A read-only value with a Copy button (MUT-434: the MCP address to paste into Claude). The value reads left to right
 * in either language, selects whole on focus, and "Copied" is announced politely; a failed copy says so, and the value
 * stays selectable to copy by hand.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const id = useId();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    setState((await copyToClipboard(value)) ? 'copied' : 'failed');
  }

  return (
    <div className="form-group hp-copy-field">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="hp-copy-row">
        <input id={id} className="input" dir="ltr" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {t('hosted.copyField.copy')}
        </Button>
      </div>
      <p className="form-hint" role="status" aria-live="polite">
        {state === 'copied' ? t('hosted.copyField.copied') : state === 'failed' ? t('hosted.copyField.failed') : ''}
      </p>
    </div>
  );
}
