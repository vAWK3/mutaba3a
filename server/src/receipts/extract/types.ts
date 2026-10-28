/** MUT-441: one line the OCR service read: its text, how sure it was (0..1), where it sits ([x0, y0, x1, y1], y down), and its script when known. */
export interface OcrLine {
  text: string;
  conf: number;
  box: readonly [number, number, number, number];
  script?: 'arab' | 'hebr' | 'latn';
}

/** What the extractor reads: a PDF's text layer when it has one (exact, no OCR), else the OCR lines. */
export interface ExtractInput {
  lines?: readonly OcrLine[] | undefined;
  pdfText?: string | null | undefined;
}

/** One row of the receipt in reading order, normalised, with the least confidence among its segments. */
export interface Row {
  text: string;
  /** `text` folded for keyword matching (lower case, Arabic letter variants folded). */
  folded: string;
  conf: number;
}
