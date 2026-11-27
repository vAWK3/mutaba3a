import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../lib/i18n/core';
import { copyToClipboard } from '../../lib/utils';
import { bareCode, codeGroups, COPIED_HOLD_MS, spokenCode } from './claimCode';

/**
 * MUT-770 (design DR-8, DT5): the claim code the accountant reads out to his customer, shown once. Six digits in Plex
 * Mono at the figure size on the field background, grouped 3 and 3, left to right in both languages (codes are LTR).
 * Screen readers hear the digits one by one ("4 8 1 7 0 2"). No confirm on close: New code recovers a lost one.
 *
 * Motion (`docs/design/motion/2026-11-27/claim-code/motion-claim-code-spec.md`): the digits settle one by one, leftmost
 * first, 10 px up and in over 320 ms on the spring, 60 ms apart; Copy cross-fades to Copied (150 ms linear) with the
 * check growing from 0.6 (240 ms spring), and reverts after a 2 s hold. Under reduced motion the code simply shows
 * (the still pose, 150 ms fade). The CSS lives in hosted.css › CodeReveal.
 */

type CopyState = 'idle' | 'copied' | 'failed';

export function CodeReveal({ code, labelledBy }: { code: string; labelledBy?: string }) {
  const t = useT();
  const id = useId();
  const [copy, setCopy] = useState<CopyState>('idle');
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  const digits = bareCode(code);

  useEffect(() => () => {
    if (revert.current) clearTimeout(revert.current);
  }, []);

  async function onCopy() {
    const copied = await copyToClipboard(digits);
    setCopy(copied ? 'copied' : 'failed');
    if (revert.current) clearTimeout(revert.current);
    if (copied) revert.current = setTimeout(() => setCopy('idle'), COPIED_HOLD_MS);
  }

  let index = 0;
  return (
    <div className="hp-code-reveal">
      <div
        className="hp-code-reveal-digits"
        dir="ltr"
        role="img"
        aria-label={spokenCode(digits)}
        aria-describedby={labelledBy}
        data-testid="claim-code"
        data-code={digits}
      >
        {codeGroups(digits).map((group) => (
          <span className="hp-code-reveal-group" key={`${index}-${group}`}>
            {group.split('').map((digit) => {
              const at = index++;
              return (
                <span className="hp-code-digit" key={at} style={{ ['--digit' as string]: at }}>
                  {digit}
                </span>
              );
            })}
          </span>
        ))}
      </div>
      <button type="button" className="hp-code-reveal-copy press" data-state={copy} onClick={() => void onCopy()} aria-describedby={`${id}-status`}>
        <span className="hp-code-reveal-icon" aria-hidden="true">
          <CopyGlyph />
          <CheckGlyph />
        </span>
        <span className="hp-code-reveal-labels">
          <span className="hp-code-reveal-copy-label" aria-hidden={copy === 'copied'}>
            {t('hosted.copyField.copy')}
          </span>
          <span className="hp-code-reveal-copied-label" aria-hidden={copy !== 'copied'}>
            {t('hosted.copyField.copied')}
          </span>
        </span>
      </button>
      <p id={`${id}-status`} className="sr-only" role="status" aria-live="polite">
        {copy === 'copied' ? t('hosted.copyField.copied') : copy === 'failed' ? t('hosted.accountantChannel.code.copyFailed') : ''}
      </p>
    </div>
  );
}

/** Claim-code key frames: the copy glyph (a rounded square) and the check (`M150 126l5 5 10-10`), drawn at 24 px. */
function CopyGlyph() {
  return (
    <svg className="hp-code-reveal-copy-glyph" width="16" height="18" viewBox="0 0 16 18" focusable="false">
      <rect x="1" y="1" width="14" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg className="hp-code-reveal-check-glyph" width="18" height="14" viewBox="148 119 19 14" focusable="false">
      <path d="M150 126l5 5 10-10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
