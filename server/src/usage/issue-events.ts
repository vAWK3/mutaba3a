import type { AllocationSource, IssueDocumentInput, UsageEventInput, UsageStamp } from '../repositories/ports.js';
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
