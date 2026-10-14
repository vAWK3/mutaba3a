import { create } from 'zustand';

/**
 * After-save feedback (MUT-81, R1): the saved row is tinted if it is on
 * screen, or a short message names where it went. One store carries the id
 * from a drawer's save to whichever list renders it; lists never decide
 * anything, they only report what they can see.
 *
 * Deliberately not wrapped in `persist` (unlike profileStore/onboardingStore):
 * this is ephemeral UI state, and resurrecting yesterday's tint on reload
 * would point at the wrong row.
 */

export interface SavedFlash {
  /** `expense` and `conversion` come from the hosted portal (MUT-91); the app marks only income and payments. */
  kind: 'income' | 'payment' | 'expense' | 'conversion';
  /** Every id that represents this save. A payment carries [paymentRecordId,
   *  transactionId], so the entry row and the payment row can both claim it. */
  ids: string[];
  clientId?: string;
  /** Captured at save time, from data the drawer already has cached -- never
   *  looked up again when the message resolves (Test review finding). */
  clientName?: string;
  profileId: string;
  /** Set once this save's message has been shown: by `rearm` after the app's
   *  Show, or by `settleMessage` when the portal notice is shown, timed out or
   *  left (MUT-91). The original message must never fire twice for one save. */
  messaged?: boolean;
}

/** How long the tint holds once the row has actually rendered (R1's AC: ~1.5s). */
export const FLASH_MS = 1500;

/** No list ever registers (e.g. a save from /settings' + Add, which has no
 *  list on screen) -- force resolution so the message still fires. A list
 *  still fetching when it fires is waited for instead: the portal refetches
 *  over the network and can take longer than this (MUT-91, eng review D3). */
export const BACKSTOP_MS = 1200;

/** However long a list keeps fetching, a save resolves by then: a hung request
 *  must not leave the person with neither a tint nor a message (MUT-91 review). */
export const MAX_WAIT_MS = 10_000;

export function matchesFlash(ids: readonly string[], flash: SavedFlash | null): boolean {
  if (!flash) return false;
  return ids.some((id) => flash.ids.includes(id));
}

export interface FlashTarget {
  to: '/clients/$clientId' | '/income';
  params?: { clientId: string };
  search?: Record<string, never>;
}

/** Pure: where Show should navigate. An entry with a client goes to the
 *  client profile; otherwise /income, with its filters reset (an empty
 *  search clears status/client-scope/search-text, the usual way a save can
 *  be filtered out of view -- MUT-83's filter model). */
export function flashTarget(flash: SavedFlash): FlashTarget {
  if (flash.clientId) {
    return { to: '/clients/$clientId', params: { clientId: flash.clientId } };
  }
  return { to: '/income', search: {} };
}

interface ListEntry {
  ids: string[];
  settled: boolean;
  /** Has this list reported at least once since the current `pending` was set? */
  reportedForCurrentSave: boolean;
}

interface SavedFlashState {
  pending: SavedFlash | null;
  flashIds: string[];
  /** null = not yet resolved; true = some list claimed it; false = none did. */
  claimed: boolean | null;
  registerList: (listId: string) => void;
  deregisterList: (listId: string) => void;
  reportSettled: (listId: string, ids: string[], settled: boolean) => void;
  markSaved: (flash: SavedFlash) => void;
  rearm: (flash: SavedFlash) => void;
  /** The message for this save has been shown (or its page left): mark it
   *  messaged so it can't be raised again, and resolve it as not claimed if no
   *  list has answered yet, so it can't tint a row on a later visit either. A
   *  call for a save that is no longer pending is ignored (MUT-91, the portal notice). */
  settleMessage: (flash: SavedFlash) => void;
  clear: () => void;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
let backstopTimer: ReturnType<typeof setTimeout> | undefined;
let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
/** Once the backstop has fired, a list that settled before the save and has
 *  not re-rendered since counts as reported: only fetching lists are waited on. */
let backstopElapsed = false;

function clearTimers() {
  clearTimeout(flashTimer);
  clearTimeout(backstopTimer);
  clearTimeout(ceilingTimer);
  flashTimer = undefined;
  backstopTimer = undefined;
  ceilingTimer = undefined;
}

export const useSavedFlashStore = create<SavedFlashState>((set, get) => {
  const lists = new Map<string, ListEntry>();

  function tryResolve() {
    const { pending, claimed } = get();
    if (!pending || claimed !== null) return;

    for (const entry of lists.values()) {
      if (matchesFlash(entry.ids, pending)) {
        clearTimers();
        set({ claimed: true, flashIds: pending.ids });
        flashTimer = setTimeout(() => {
          // By the save's ids, not the object: settleMessage swaps in a messaged copy (MUT-91).
          set((state) => (state.pending?.ids === pending.ids ? { flashIds: [] } : {}));
        }, FLASH_MS);
        return;
      }
    }

    const everyRegisteredListReported =
      lists.size > 0 &&
      Array.from(lists.values()).every((entry) => entry.settled && (entry.reportedForCurrentSave || backstopElapsed));
    if (everyRegisteredListReported) {
      clearTimers();
      set({ claimed: false });
    }
  }

  function armCeiling(flash: SavedFlash) {
    ceilingTimer = setTimeout(() => {
      set((state) => (state.pending === flash && state.claimed === null ? { claimed: false } : {}));
    }, MAX_WAIT_MS);
  }

  return {
    pending: null,
    flashIds: [],
    claimed: null,

    registerList: (listId) => {
      if (!lists.has(listId)) lists.set(listId, { ids: [], settled: false, reportedForCurrentSave: false });
    },

    deregisterList: (listId) => {
      lists.delete(listId);
      tryResolve();
    },

    reportSettled: (listId, ids, settled) => {
      lists.set(listId, { ids, settled, reportedForCurrentSave: settled });
      if (settled) tryResolve();
    },

    markSaved: (flash) => {
      clearTimers();
      backstopElapsed = false;
      for (const entry of lists.values()) entry.reportedForCurrentSave = false;
      set({ pending: flash, claimed: null, flashIds: [] });
      backstopTimer = setTimeout(() => {
        const { pending, claimed } = get();
        if (pending !== flash || claimed !== null) return;
        backstopElapsed = true;
        if (lists.size === 0) set({ claimed: false });
        else tryResolve();
      }, BACKSTOP_MS);
      armCeiling(flash);
      // A list already mounted and settled (e.g. the client profile's own
      // entry list, re-rendered from the same invalidation that created this
      // save) may already match -- check immediately, don't wait for its
      // next report.
      tryResolve();
    },

    rearm: (flash) => {
      clearTimers();
      backstopElapsed = false;
      for (const entry of lists.values()) entry.reportedForCurrentSave = false;
      set({ pending: flash, claimed: null, flashIds: [] });
      armCeiling(flash);
      tryResolve();
    },

    settleMessage: (flash) => {
      set((state) => (state.pending === flash && !flash.messaged ? { pending: { ...flash, messaged: true }, claimed: state.claimed ?? false } : {}));
    },

    clear: () => {
      clearTimers();
      backstopElapsed = false;
      lists.clear();
      set({ pending: null, flashIds: [], claimed: null });
    },
  };
});
