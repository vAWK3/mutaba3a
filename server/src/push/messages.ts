import type { UserLocale } from '../repositories/ports.js';
import type { PushKind } from './ports.js';

/**
 * MUT-780 (ADR-352): the words of each push, Arabic and English, minimal. Counts only: a lock screen must not show a
 * customer's name or address (ADR-300 d3).
 */
export interface PushCopy {
  title: string;
  body: string;
}

type Vars = Readonly<Record<string, number>>;

const EN_TITLE = 'MTB3A';
const AR_TITLE = 'متابعة';

/** Arabic counted noun: 1, 2, 3 to 10, 11 and over. */
function arCustomers(n: number): string {
  if (n === 1) return 'زبون واحد لم يستلم حسابه';
  if (n === 2) return 'زبونان لم يستلما حسابيهما';
  if (n <= 10) return `${n} زبائن لم يستلموا حساباتهم`;
  return `${n} زبونًا لم يستلموا حساباتهم`;
}

const COPY: Record<PushKind, { en: (v: Vars) => PushCopy; ar: (v: Vars) => PushCopy }> = {
  unclaimed_digest: {
    en: ({ waiting = 0, removingSoon = 0 }) => ({
      title: EN_TITLE,
      body: `${waiting === 1 ? '1 customer hasn’t claimed their account' : `${waiting} customers haven’t claimed their accounts`}${removingSoon > 0 ? ` · ${removingSoon} removed within a week` : ''}`,
    }),
    ar: ({ waiting = 0, removingSoon = 0 }) => ({
      title: AR_TITLE,
      body: `${arCustomers(waiting)}${removingSoon > 0 ? ` · ${removingSoon} تُحذف خلال أسبوع` : ''}`,
    }),
  },
};

export function renderPush(kind: PushKind, vars: Vars, locale: UserLocale): PushCopy {
  const copy = COPY[kind];
  // The portal and phone are Arabic and English only (ADR: portal ar+en); any other stored locale reads English.
  return locale === 'ar' ? copy.ar(vars) : copy.en(vars);
}
