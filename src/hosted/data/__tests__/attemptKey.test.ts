import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createAttemptKey, useAttemptKey } from '../attemptKey';

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

describe('createAttemptKey (MUT-133)', () => {
  it('reuses the key when the same body is sent again, so a retry replays instead of writing twice', () => {
    const attempt = createAttemptKey(counter());
    const first = attempt.keyFor({ amount: '100.00', kind: 'received' });
    expect(attempt.keyFor({ amount: '100.00', kind: 'received' })).toBe(first);
  });

  it('mints a new key when the body changes, since the server refuses a reused key with a different body', () => {
    const attempt = createAttemptKey(counter());
    const first = attempt.keyFor({ amount: '100.00' });
    expect(attempt.keyFor({ amount: '120.00' })).not.toBe(first);
  });

  it('mints a new key after a success, so the next entry is a new write', () => {
    const attempt = createAttemptKey(counter());
    const first = attempt.keyFor({ amount: '100.00' });
    attempt.succeeded();
    expect(attempt.keyFor({ amount: '100.00' })).not.toBe(first);
  });

  it('keeps one attempt across renders of the hook', () => {
    const { result, rerender } = renderHook(() => useAttemptKey());
    const first = result.current.keyFor({ a: 1 });
    rerender();
    expect(result.current.keyFor({ a: 1 })).toBe(first);
  });
});
