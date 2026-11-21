/** Exactly one copy of a document reads "מקור" (original); every later one reads "העתק" (copy). */
export type CopyLabel = 'ORIGINAL' | 'COPY';

export function copyLabel(copyIndex: number): CopyLabel {
  return copyIndex === 0 ? 'ORIGINAL' : 'COPY';
}
