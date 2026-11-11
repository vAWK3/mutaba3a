import { formatMoney, type Currency } from '../money.js';
import type { ExpenseCategoryRecord, ExpenseRecord, UpdateExpensePatch, UserLocale } from '../repositories/ports.js';
import { categoryNameKey } from './names.js';
import { categoryNameIn, presetKeyForName } from './presets.js';
import { NO_EXPENSE_VAT } from './vat.js';

/**
 * MUT-589 (ADR-252, D1): what a saved expense becomes when it moves to another of the person's profiles, and the list
 * of what a person sees change. Pure: the caller reads everything it needs. The preview and the move both run it (the
 * move again, right before its transaction, with the target as it is then: review R2), and the move answers the list it
 * applied.
 *
 * Never changed: the amount and its currency (ADR-004), the date, title, notes and the typed vendor text.
 */

/** The fields a move can change, in the order they are listed. */
export const EXPENSE_MOVE_FIELDS = ['category', 'client', 'matter', 'vat', 'allocationNumber', 'groups'] as const;
export type ExpenseMoveField = (typeof EXPENSE_MOVE_FIELDS)[number];

/** One line of the confirm step: a display value before and after; `to: null` = cleared. */
export interface ExpenseMoveChange {
  field: ExpenseMoveField;
  from: string | null;
  to: string | null;
}

export interface ExpenseMoveContext {
  /** Names are listed as this viewer reads them (a seeded category follows the language, MUT-464). */
  lang: UserLocale;
  /** The expense's category on the source profile, by its stored name; null when it has none. */
  sourceCategoryName: string | null;
  /** The target's categories, archived ones included (they are never chosen). */
  targetCategories: ReadonlyArray<Pick<ExpenseCategoryRecord, 'id' | 'name' | 'archivedAt'>>;
  /** MUT-300: firm features on the target; VAT is kept only there. */
  targetFirm: boolean;
  /** The vendor the typed vendor resolved to on the target (`withResolvedVendor`); null for none. */
  targetVendorId: string | null;
  clientName: string | null;
  matterName: string | null;
  /** Names of the groups the expense is in on the source, and the target groups its date puts it in. */
  sourceGroups: readonly string[];
  targetGroups: readonly string[];
}

export interface ExpenseMovePlan {
  patch: UpdateExpensePatch;
  changes: ExpenseMoveChange[];
}

type TargetCategory = ExpenseMoveContext['targetCategories'][number];

/** Same name (nameKey), else the same preset entry across languages, else the target's Other, else none. */
function mapCategory(sourceName: string, targets: readonly TargetCategory[]): TargetCategory | null {
  const live = targets.filter((c) => c.archivedAt === null);
  const key = categoryNameKey(sourceName);
  const sameName = live.find((c) => categoryNameKey(c.name) === key);
  if (sameName) return sameName;
  const presetKey = presetKeyForName(sourceName);
  const samePreset = presetKey === null ? undefined : live.find((c) => presetKeyForName(c.name) === presetKey);
  return samePreset ?? live.find((c) => presetKeyForName(c.name) === 'other') ?? null;
}

const groupList = (names: readonly string[]): string | null => (names.length === 0 ? null : [...names].sort((a, b) => a.localeCompare(b)).join(', '));

export function planExpenseMove(expense: ExpenseRecord, ctx: ExpenseMoveContext): ExpenseMovePlan {
  const changes: ExpenseMoveChange[] = [];
  const category = ctx.sourceCategoryName === null ? null : mapCategory(ctx.sourceCategoryName, ctx.targetCategories);
  const patch: UpdateExpensePatch = { categoryId: category?.id ?? null, vendorId: ctx.targetVendorId, customerId: null, projectId: null };

  if (ctx.sourceCategoryName !== null) {
    const from = categoryNameIn(ctx.sourceCategoryName, ctx.lang);
    const to = category ? categoryNameIn(category.name, ctx.lang) : null;
    if (from !== to) changes.push({ field: 'category', from, to });
  }
  if (expense.customerId !== null) changes.push({ field: 'client', from: ctx.clientName, to: null });
  if (expense.projectId !== null) changes.push({ field: 'matter', from: ctx.matterName, to: null });

  if (!ctx.targetFirm) {
    if (expense.vatTreatment !== null) {
      Object.assign(patch, NO_EXPENSE_VAT);
      changes.push({ field: 'vat', from: formatMoney({ minor: expense.vatMinor ?? 0n, currency: expense.currency as Currency }), to: null });
    }
    if (expense.allocationNumber !== null) {
      patch.allocationNumber = null;
      changes.push({ field: 'allocationNumber', from: expense.allocationNumber, to: null });
    }
  }

  const fromGroups = groupList(ctx.sourceGroups);
  const toGroups = groupList(ctx.targetGroups);
  if (fromGroups !== toGroups) changes.push({ field: 'groups', from: fromGroups, to: toGroups });
  return { patch, changes };
}
