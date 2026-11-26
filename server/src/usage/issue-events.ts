import type { AllocationSource, IssueDocumentInput, UsageEventInput, UsageStamp } from '../repositories/ports.js';
import { hardCapOf } from './caps.js';
import { usageEvent } from './event.js';

/**
 * MUT-735 (ADR-281): what a created document records. Every type is DOCUMENT_ISSUED (detail = its type), keyed by the
 * document's id; one carrying an allocation number also records ALLOCATION_REQUESTED (AUTOMATIC from the Tax
 * Authority API, MANUAL when entered by hand). Pure.
 */
export function issueUsageEvents(stamp: UsageStamp, input: Pick<IssueDocumentInput, 'organizationId' | 'docType'>, documentId: string, allocationSource: AllocationSource | null, at: Date): UsageEventInput[] {
  const scope = { organizationId: input.organizationId, entityKey: documentId };
  const events = [usageEvent(stamp, { kind: 'DOCUMENT_ISSUED', detail: input.docType, ...scope }, at)];
  if (allocationSource) events.push(usageEvent(stamp, { kind: 'ALLOCATION_REQUESTED', detail: allocationSource === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC', ...scope }, at));
  return events;
}

/**
 * MUT-731 (ADR-284, Basel 2026-11-25): the documents cap this issue passes to the counter. Every document counts, but a
 * receipt for a payment on a document already issued is never refused (it still counts in the usage numbers): only new
 * documents stop at the cap. Null = counted, never refused (no hard cap on the payer's plan).
 */
export function documentCapOf(stamp: UsageStamp, input: Pick<IssueDocumentInput, 'docType' | 'appliesToDocumentId'>): number | null {
  if (input.docType === 'RECEIPT' && input.appliesToDocumentId) return null;
  return hardCapOf(stamp.plan, 'DOCUMENTS');
}
