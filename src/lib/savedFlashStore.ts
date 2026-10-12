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
  kind: 'income' | 'payment';
  /** Every id that represents this save. A payment carries [paymentRecordId,
   *  transactionId], so the entry row and the payment row can both claim it. */
  ids: string[];
  clientId?: string;
  /** Captured at save time, from data the drawer already has cached -- never
   *  looked up again when the message resolves (Test review finding). */
  clientName?: string;
  profileId: string;
  /** Set by `rearm` after Show: the original "Saved to X" message must never
   *  fire twice for the same save. */
  messaged?: boolean;
}

/** How long the tint holds once the row has actually rendered (R1's AC: ~1.5s). */
export const FLASH_MS = 1500;

/** No list ever registers (e.g. a save from /settings' + Add, which has no
 *  list on screen) -- force resolution so the message still fires. */
export const BACKSTOP_MS = 1200;

export function matchesFlash(ids: readonly string[], flash: SavedFlash | null): boolean {
  if (!flash) return false;
  return ids.some((id) => flash.ids.includes(id));
}

export interface FlashTarget {
  to: '/clients/$clientId' | '/income';
  params?: { clientId: string };
}

/** Pure: where Show should navigate. An entry with a client goes to the
 *  client profile; otherwise /income (the drawer re-arms the filters there). */
export function flashTarget(flash: SavedFlash): FlashTarget {
  if (flash.clientId) {
    return { to: '/clients/$clientId', params: { clientId: flash.clientId } };
  }
  return { to: '/income' };
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
  clear: () => void;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
let backstopTimer: ReturnType<typeof setTimeout> | undefined;

function clearTimers() {
  clearTimeout(flashTimer);
  clearTimeout(backstopTimer);
  flashTimer = undefined;
  backstopTimer = undefined;
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
          set((state) => (state.pending === pending ? { flashIds: [] } : {}));
        }, FLASH_MS);
        return;
      }
    }

    const everyRegisteredListReported =
      lists.size > 0 && Array.from(lists.values()).every((entry) => entry.reportedForCurrentSave && entry.settled);
    if (everyRegisteredListReported) {
      clearTimers();
      set({ claimed: false });
    }
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
      for (const entry of lists.values()) entry.reportedForCurrentSave = false;
      set({ pending: flash, claimed: null, flashIds: [] });
      backstopTimer = setTimeout(() => {
        set((state) => (state.pending === flash && state.claimed === null ? { claimed: false } : {}));
      }, BACKSTOP_MS);
      // A list already mounted and settled (e.g. the client profile's own
      // entry list, re-rendered from the same invalidation that created this
      // save) may already match -- check immediately, don't wait for its
      // next report.
      tryResolve();
    },

    rearm: (flash) => {
      clearTimers();
      for (const entry of lists.values()) entry.reportedForCurrentSave = false;
      set({ pending: flash, claimed: null, flashIds: [] });
      tryResolve();
    },

    clear: () => {
      clearTimers();
      lists.clear();
      set({ pending: null, flashIds: [], claimed: null });
    },
  };
});
