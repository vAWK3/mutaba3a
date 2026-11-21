import type { IssuedDocumentCounterRecord, IssuedNumberGap } from '../repositories/ports.js';

/** AC5: the numbers from a type's start to the last one taken that have no document. None in normal use. */
export function numberGaps(counter: IssuedDocumentCounterRecord, numbers: readonly number[]): IssuedNumberGap {
  const taken = new Set(numbers);
  const last = counter.next - 1;
  const missing: number[] = [];
  for (let n = counter.start; n <= last; n += 1) if (!taken.has(n)) missing.push(n);
  return { docType: counter.docType, start: counter.start, last, missing };
}
