/**
 * MUT-441 AC2: a field whose confidence is under this is left out, never suggested wrong. A field's confidence is its
 * rule's strength (how telling the pattern is: a labelled total the arithmetic confirms, a bare date, …) times how
 * sure the OCR was of the box it came from (1 for a PDF's text layer).
 */
export const MIN_FIELD_CONFIDENCE = 0.6;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function isConfident(confidence: number): boolean {
  return round2(confidence) >= MIN_FIELD_CONFIDENCE;
}
