import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSavedFlashStore,
  flashTarget,
  matchesFlash,
  FLASH_MS,
  BACKSTOP_MS,
  MAX_WAIT_MS,
  type SavedFlash,
} from '../savedFlashStore';

function income(overrides: Partial<SavedFlash> = {}): SavedFlash {
  return {
    kind: 'income',
    ids: ['tx-1'],
    clientId: 'client-1',
    clientName: 'Furniture Co.',
    profileId: 'profile-1',
    ...overrides,
  };
}

describe('flashTarget (pure)', () => {
  it('routes to the client profile when the flash has a client', () => {
    const target = flashTarget(income());
    expect(target).toEqual({ to: '/clients/$clientId', params: { clientId: 'client-1' } });
  });

  it('routes to /income with filters reset when the entry has no client', () => {
    const target = flashTarget(income({ clientId: undefined }));
    expect(target.to).toBe('/income');
  });
});

describe('matchesFlash (pure)', () => {
  it('is true when any rendered id intersects the flash ids', () => {
    expect(matchesFlash(['a', 'tx-1', 'b'], income())).toBe(true);
  });

  it('is false with no intersection', () => {
    expect(matchesFlash(['a', 'b'], income())).toBe(false);
  });

  it('is false against a null flash', () => {
    expect(matchesFlash(['tx-1'], null)).toBe(false);
  });
});

describe('useSavedFlashStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => {
      useSavedFlashStore.getState().clear();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with nothing pending', () => {
    const { result } = renderHook(() => useSavedFlashStore());
    expect(result.current.pending).toBeNull();
    expect(result.current.flashIds).toEqual([]);
    expect(result.current.claimed).toBeNull();
  });

  it('markSaved sets pending and resets claimed', () => {
    const { result } = renderHook(() => useSavedFlashStore());
    act(() => result.current.markSaved(income()));
    expect(result.current.pending).toEqual(income());
    expect(result.current.claimed).toBeNull();
    expect(result.current.flashIds).toEqual([]);
  });

  it('a second save replaces the first', () => {
    const { result } = renderHook(() => useSavedFlashStore());
    act(() => result.current.markSaved(income({ ids: ['tx-1'] })));
    act(() => result.current.markSaved(income({ ids: ['tx-2'] })));
    expect(result.current.pending?.ids).toEqual(['tx-2']);
  });

  describe('registerList / reportSettled / resolve', () => {
    it('a settled report that intersects pending claims it and starts the tint', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.reportSettled('list-a', ['tx-1'], true);
      });
      expect(result.current.claimed).toBe(true);
      expect(result.current.flashIds).toEqual(['tx-1']);
    });

    it('does not claim from an unsettled report', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.reportSettled('list-a', ['tx-1'], false);
      });
      expect(result.current.claimed).toBeNull();
      expect(result.current.flashIds).toEqual([]);
    });

    it('resolves unclaimed once every registered list has reported settled with no match', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.registerList('list-b');
        result.current.reportSettled('list-a', ['other-1'], true);
      });
      expect(result.current.claimed).toBeNull(); // list-b hasn't reported yet
      act(() => result.current.reportSettled('list-b', ['other-2'], true));
      expect(result.current.claimed).toBe(false);
    });

    it('one list claiming it is enough even if another list never has the row', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.registerList('list-b');
        result.current.reportSettled('list-b', ['other-1'], true);
        result.current.reportSettled('list-a', ['tx-1'], true);
      });
      expect(result.current.claimed).toBe(true);
    });

    it('deregistering the only unsettled list lets resolution proceed', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.registerList('list-b');
        result.current.reportSettled('list-a', ['other-1'], true);
        result.current.deregisterList('list-b');
      });
      expect(result.current.claimed).toBe(false);
    });

    it('the backstop fires claimed=false when no list ever registers', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => result.current.markSaved(income()));
      expect(result.current.claimed).toBeNull();
      act(() => vi.advanceTimersByTime(BACKSTOP_MS));
      expect(result.current.claimed).toBe(false);
    });

    it('a claim before the backstop cancels it', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.reportSettled('list-a', ['tx-1'], true);
      });
      act(() => vi.advanceTimersByTime(BACKSTOP_MS));
      expect(result.current.claimed).toBe(true); // not flipped back to false
    });

    // MUT-91 (eng review D3): the portal refetches over the network, so a list
    // can still be loading when the backstop fires. It must not answer "not
    // claimed" for a row that is about to arrive.
    it('the backstop waits while a registered list is still fetching; the row arriving later claims it', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.registerList('list-a');
        result.current.markSaved(income());
        result.current.reportSettled('list-a', ['tx-0'], false);
      });
      act(() => vi.advanceTimersByTime(BACKSTOP_MS));
      expect(result.current.claimed).toBeNull();
      act(() => vi.advanceTimersByTime(1800));
      act(() => result.current.reportSettled('list-a', ['tx-0', 'tx-1'], true));
      expect(result.current.claimed).toBe(true);
      expect(result.current.flashIds).toEqual(['tx-1']);
    });

    it('a list still fetching at the backstop that settles without the row resolves not claimed then', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.registerList('list-a');
        result.current.markSaved(income());
        result.current.reportSettled('list-a', ['tx-0'], false);
      });
      act(() => vi.advanceTimersByTime(BACKSTOP_MS));
      expect(result.current.claimed).toBeNull();
      act(() => result.current.reportSettled('list-a', ['tx-0'], true));
      expect(result.current.claimed).toBe(false);
    });

    it('after the backstop, a list that settled before the save and never re-reported does not hold resolution', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.registerList('list-quiet');
        result.current.reportSettled('list-quiet', ['tx-0'], true);
        result.current.registerList('list-busy');
        result.current.markSaved(income());
        result.current.reportSettled('list-busy', ['tx-0'], false);
      });
      act(() => vi.advanceTimersByTime(BACKSTOP_MS));
      expect(result.current.claimed).toBeNull();
      act(() => result.current.reportSettled('list-busy', ['tx-0'], true));
      expect(result.current.claimed).toBe(false);
    });

    it('a list that never settles cannot hold the save forever: MAX_WAIT_MS answers not claimed (review)', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.registerList('list-a');
        result.current.markSaved(income());
        result.current.reportSettled('list-a', ['tx-0'], false);
      });
      act(() => vi.advanceTimersByTime(MAX_WAIT_MS - 1));
      expect(result.current.claimed).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.claimed).toBe(false);
    });

    it('the backstop still answers not claimed when every registered list is settled but none re-reported', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.registerList('list-a');
        result.current.reportSettled('list-a', ['tx-0'], true);
        result.current.markSaved(income());
      });
      act(() => vi.advanceTimersByTime(BACKSTOP_MS));
      expect(result.current.claimed).toBe(false);
    });
  });

  describe('tint lifetime', () => {
    it('flashIds clears FLASH_MS after the claiming report, not after markSaved', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => result.current.markSaved(income()));
      act(() => vi.advanceTimersByTime(1000)); // time passes before the row even renders
      act(() => {
        result.current.registerList('list-a');
        result.current.reportSettled('list-a', ['tx-1'], true);
      });
      act(() => vi.advanceTimersByTime(FLASH_MS - 1));
      expect(result.current.flashIds).toEqual(['tx-1']);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.flashIds).toEqual([]);
    });

    it('rearm restarts the tint clock', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => {
        result.current.markSaved(income());
        result.current.registerList('list-a');
        result.current.reportSettled('list-a', ['tx-1'], true);
      });
      act(() => vi.advanceTimersByTime(FLASH_MS - 100));
      act(() => result.current.rearm({ ...income(), messaged: true }));
      act(() => {
        result.current.reportSettled('list-a', ['tx-1'], true);
      });
      act(() => vi.advanceTimersByTime(200));
      expect(result.current.flashIds).toEqual(['tx-1']); // still tinted: clock restarted
    });

    it('rearm sets messaged so the original message cannot fire twice', () => {
      const { result } = renderHook(() => useSavedFlashStore());
      act(() => result.current.markSaved(income()));
      act(() => result.current.rearm({ ...income(), messaged: true }));
      expect(result.current.pending?.messaged).toBe(true);
    });
  });

  it('settleMessage marks that save messaged and keeps its resolution; a stale flash is ignored (MUT-91)', () => {
    const { result } = renderHook(() => useSavedFlashStore());
    const first = income();
    act(() => {
      result.current.markSaved(first);
      result.current.registerList('list-a');
      result.current.reportSettled('list-a', ['tx-0'], true);
    });
    expect(result.current.claimed).toBe(false);
    act(() => result.current.settleMessage(first));
    expect(result.current.pending).toMatchObject({ ids: ['tx-1'], messaged: true });
    expect(result.current.claimed).toBe(false);

    const second = income({ ids: ['tx-2'] });
    act(() => result.current.markSaved(second));
    act(() => result.current.settleMessage(first));
    expect(result.current.pending).toBe(second);

    // Unresolved when settled (its page was left): resolved as not claimed, so a later visit can't tint it.
    act(() => result.current.settleMessage(second));
    expect(result.current.claimed).toBe(false);
    act(() => result.current.reportSettled('list-a', ['tx-2'], true));
    expect(result.current.flashIds).toEqual([]);
  });

  it('clear resets everything', () => {
    const { result } = renderHook(() => useSavedFlashStore());
    act(() => {
      result.current.markSaved(income());
      result.current.registerList('list-a');
      result.current.reportSettled('list-a', ['tx-1'], true);
    });
    act(() => result.current.clear());
    expect(result.current.pending).toBeNull();
    expect(result.current.flashIds).toEqual([]);
    expect(result.current.claimed).toBeNull();
  });

  it('is never wrapped in persist: no localStorage key for this store', () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    const keys = Object.keys(window.localStorage);
    expect(keys.some((k) => /saved-?flash/i.test(k))).toBe(false);
  });
});
