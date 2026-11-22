/** Exactly one copy of a document reads "מקור" (original); every later one reads "העתק" (copy). */
export type CopyLabel = 'ORIGINAL' | 'COPY';

export function copyLabel(copyIndex: number): CopyLabel {
  return copyIndex === 0 ? 'ORIGINAL' : 'COPY';
}

/** A produced copy's request key replays (same copy, same mark) for the same person within this window only. */
export const COPY_REPLAY_MS = 24 * 60 * 60 * 1000;
