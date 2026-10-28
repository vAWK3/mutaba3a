import { parseAmount } from '../agreements/compose.js';
import { composePreview, type PreviewBody } from '../agreements/create.js';
import type { Currency } from '../money.js';
import { previewToken } from '../preview-token.js';
import type { AgreementType, JsonObject, LedgerStore, Organization } from '../repositories/ports.js';
import { composeRetainerPreview, type RetainerBody } from '../retainers/create.js';

/**
 * MUT-479 (D1, D2, D5): a fee proposal's agreement, drafted. One union over the three kinds, each composed by its own
 * kind's rules (`composePreview` for FIXED and CONTINGENCY, `composeRetainerPreview` for RETAINER), never a fork of
 * them. The project is the proposal's and the agreement date is the day it is composed for (proposedOn at create,
 * approvedOn at approval), so neither is in the draft; nor is the currency (the project's).
 */

type AgreementFields = Omit<PreviewBody, 'projectId' | 'agreementDate' | 'currency' | 'contingency'>;
export type FixedDraft = { kind: 'FIXED' } & AgreementFields;
export type ContingencyDraft = { kind: 'CONTINGENCY'; contingency: NonNullable<PreviewBody['contingency']> } & AgreementFields;
export type RetainerDraft = { kind: 'RETAINER' } & Omit<RetainerBody, 'projectId' | 'agreementDate' | 'currency'>;
export type AgreementDraft = FixedDraft | ContingencyDraft | RetainerDraft;

/** R3: what `fee_proposals.draft` holds. Wire strings only; read back as pre-fill, never re-parsed or re-composed. */
export const DRAFT_SCHEMA_VERSION = 1;
export type StoredAgreementDraft = JsonObject & { schemaVersion: typeof DRAFT_SCHEMA_VERSION };

export function agreementTypeOf(draft: AgreementDraft): AgreementType {
  return draft.kind === 'RETAINER' ? 'RECURRING' : draft.kind;
}

/** D2/D5: the proposal's amount — the fixed total, the contingency upfront, or the retainer's monthly amount. */
export function agreedAmountOf(draft: AgreementDraft, currency: Currency, prefix = 'agreement'): bigint {
  return draft.kind === 'RETAINER' ? parseAmount(draft.monthlyAmount, currency, `${prefix}.monthlyAmount`) : parseAmount(draft.amount, currency, `${prefix}.amount`);
}

export function toAgreementBody(draft: AgreementDraft, projectId: string, agreementDate: string): PreviewBody {
  if (draft.kind === 'RETAINER') throw new Error('toAgreementBody: a RETAINER draft composes as a retainer');
  const { kind, ...fields } = draft;
  void kind;
  return { ...fields, projectId, agreementDate };
}

export function toRetainerBody(draft: AgreementDraft, projectId: string, agreementDate: string): RetainerBody {
  if (draft.kind !== 'RETAINER') throw new Error(`toRetainerBody: a ${draft.kind} draft composes as an agreement`);
  const { kind, ...fields } = draft;
  void kind;
  return { ...fields, projectId, agreementDate };
}

/** A draft composed by its own kind's rules; `rateBasisPoints` is the rate its outcome depended on. */
export type ComposedDraft =
  | { kind: 'AGREEMENT'; body: PreviewBody; preview: Awaited<ReturnType<typeof composePreview>>; rateBasisPoints: number }
  | { kind: 'RETAINER'; body: RetainerBody; preview: Awaited<ReturnType<typeof composeRetainerPreview>>; rateBasisPoints: number };

export async function composeDraft(store: LedgerStore, organization: Organization, draft: AgreementDraft, projectId: string, agreementDate: string, today: string): Promise<ComposedDraft> {
  if (draft.kind === 'RETAINER') {
    const body = toRetainerBody(draft, projectId, agreementDate);
    const preview = await composeRetainerPreview(store, organization, body, today);
    return { kind: 'RETAINER', body, preview, rateBasisPoints: preview.context.rateBasisPoints };
  }
  const body = toAgreementBody(draft, projectId, agreementDate);
  const preview = await composePreview(store, organization, body, today);
  return { kind: 'AGREEMENT', body, preview, rateBasisPoints: preview.vatRateBasisPoints };
}

export function storedDraftOf(draft: AgreementDraft): StoredAgreementDraft {
  return JSON.parse(JSON.stringify({ schemaVersion: DRAFT_SCHEMA_VERSION, ...draft })) as StoredAgreementDraft;
}

/** D5: whether the agreement approved differs from the one proposed; null when the proposal stored no draft. */
export function draftChanged(stored: JsonObject | null, agreement: AgreementDraft): boolean | null {
  if (!stored) return null;
  const { schemaVersion, ...proposed } = stored;
  void schemaVersion;
  return previewToken([proposed]) !== previewToken([agreement]);
}

/** D4, R5: everything an approval's outcome depends on, so any change between preview and approve is PREVIEW_STALE. */
export function approveTokenParts(organizationId: string, proposal: { id: string; version: number }, approvedOn: string, agreement: AgreementDraft, rateBasisPoints: number): unknown[] {
  return [organizationId, 'proposal-approve', proposal.id, proposal.version, approvedOn, agreement, rateBasisPoints];
}
