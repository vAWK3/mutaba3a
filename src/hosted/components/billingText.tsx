import { Fragment, type ReactNode } from 'react';
import type { useT } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { formatDecimal } from '../format/DecimalAmount';
import { minorToDecimal } from '../format/currencies';

/** The Billing drawer's text helpers (MUT-362; MUT-531 split them out of the drawer for its steps). */

type Translate = ReturnType<typeof useT>;

export function formatMinor(minor: number, currency: 'ILS' | 'USD', language: Language): string {
  return formatDecimal(minorToDecimal(minor, currency), currency, language);
}

/** Marks a node's place in a translated sentence; no translation contains it (InsightList's way). */
const MARK = '\u0001';
const MARKED = new RegExp(`(${MARK}\\d+${MARK})`);

/** A translated sentence whose `{vars}` are nodes (amounts stay their own <bdi>, ADR-101), or plain strings. */
export function sentence(t: Translate, key: string, vars: Record<string, ReactNode>): ReactNode[] {
  const entries = Object.entries(vars).map(([name, node], i) => ({ name, node, mark: `${MARK}${i}${MARK}` }));
  const byMark = new Map(entries.map((e) => [e.mark, e.node]));
  const text = t(key, Object.fromEntries(entries.map((e) => [e.name, e.mark])));
  return text.split(MARKED).map((piece, i) => (byMark.has(piece) ? <Fragment key={i}>{byMark.get(piece)}</Fragment> : piece));
}
