import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useLanguage } from '../../lib/i18n/core';
import { ApiError, apiErrorReason, api, type HostedProfile, type IssueDocumentRequest, type IssuedDocType, type IssuedDocument } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { canAddClient } from '../data/incomeAffordances';
import { openPdf, useDocumentPreview, useIssueDocument } from '../data/issuedQueries';
import { useIssuer, useIssuingSetup } from '../data/issuingQueries';
import { formatDecimal } from '../format/DecimalAmount';
import { todayInZone } from '../format/dates';
import { useWritableFor } from '../session/me';
import { ClientPicker } from './ClientPicker';
import { allocationDigits } from './expenseForm/useHostedExpenseForm';
import { minorDigitsToDecimal } from '../lib/receiptSuggestion';
import { ManualAllocationPanel } from './ManualAllocationPanel';
import { Drawer } from './Drawer';
import { Skeleton } from './QueryView';
import { useToast } from './Toast';
import { TwoFactorIssuingPrompt } from '../twoFactor/TwoFactorIssuingPrompt';
import { documentRefusedNow, limitFromUsage, planLimitOf, upgradeOffered, type StarterMeter } from '../data/planUsage';
import { useStarterUsage } from '../data/useStarterUsage';
import { PlanLimitNotice, UpgradeToSolo } from './PlanLimitNotice';
import { LeftLine } from './StarterPlan';
import { isTwoFactorRefusal } from '../twoFactor/twoFactor';

/**
 * MUT-570 (direction B, P1/P2/P4): issue a tax invoice, invoice-receipt, receipt or credit note from a drawer over the
 * list. Client first (recent and search, or add one), then the type, the lines with one "prices include VAT" switch
 * per document and each line's options inline, the payment for a document that takes one, and live totals from the
 * server's preview (nothing is written until Issue). The draft PDF opens from here, watermarked. Issuing is final:
 * the button names the type and one line says a credit note is the only correction.
 */
export interface IssueStart {
  customerId?: string;
  docType?: IssuedDocType;
  /** A credit note: the tax invoice it credits (its lines come too). */
  originalId?: string;
  /** A receipt: the open tax invoice it pays; a receipt or invoice-receipt: the payment request it settles (MUT-662). */
  appliesToDocumentId?: string;
  lines?: Line[];
  /** A receipt paying an invoice: the remaining amount. */
  amount?: string;
  /** The original's "prices include VAT" (a credit note or a similar document keeps it). */
  pricesIncludeVat?: boolean;
  /** MUT-648 (I1-a): the recorded Owed or Received this document is for; it takes the entry over (no second one). */
  fromEntry?: { kind: 'owed' | 'received'; id: string };
}

export interface Line {
  description: string;
  kind: 'GOODS' | 'SERVICE';
  quantity: string;
  unitPrice: string;
  discount: string;
  /** undefined = the document's switch. */
  pricesIncludeVat?: boolean;
  vatExempt?: boolean;
}

const EMPTY_LINE: Line = { description: '', kind: 'SERVICE', quantity: '1', unitPrice: '', discount: '' };
const DECIMAL = /^\d{1,13}(\.\d{1,2})?$/;
const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;
const positiveQuantity = (q: string) => QUANTITY.test(q.trim()) && /[1-9]/.test(q);
const DESCRIPTION_MAX = 300;
const money = (v: string) => (DECIMAL.test(v.trim()) ? (v.includes('.') ? v.trim().padEnd(v.trim().indexOf('.') + 3, '0') : `${v.trim()}.00`) : null);

/** A document type's own word for the button and the heading. */
const TYPES: IssuedDocType[] = ['TAX_INVOICE', 'PAYMENT_REQUEST', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE'];

export function IssueDocumentDrawer(props: { profile: HostedProfile; start?: IssueStart; onClose: () => void; onIssued: (doc: IssuedDocument) => void }) {
  const { t } = useLanguage();
  const setup = useIssuingSetup(props.profile.id);
  const issuer = useIssuer(props.profile.id);
  // Review fix: the form starts from the issuer (dealer type, VAT pricing, language), so it waits for it.
  if (!setup.data || issuer.data === undefined) {
    return (
      <Drawer title={t('hosted.issue.title')} onClose={props.onClose} closeLabel={t('common.close')}>
        <Skeleton />
      </Drawer>
    );
  }
  return <IssueForm {...props} />;
}

function IssueForm({ profile, start = {}, onClose, onIssued }: { profile: HostedProfile; start?: IssueStart; onClose: () => void; onIssued: (doc: IssuedDocument) => void }) {
  const { t, language } = useLanguage();
  const toast = useToast();
  const formId = useId();
  const writable = useWritableFor(profile);
  const setup = useIssuingSetup(profile.id);
  const issuer = useIssuer(profile.id);
  const issue = useIssueDocument(profile.id);
  const attempt = useAttemptKey();
  const today = todayInZone(profile.timezone);
  const exempt = issuer.data?.dealerType === 'EXEMPT';

  const [customerId, setCustomerId] = useState(start.customerId ?? '');
  const [docType, setDocType] = useState<IssuedDocType>(start.docType ?? (exempt ? 'RECEIPT' : 'TAX_INVOICE'));
  const [lines, setLines] = useState<Line[]>(start.lines ?? [{ ...EMPTY_LINE, unitPrice: start.amount ?? '' }]);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [vatIncluded, setVatIncluded] = useState<boolean | null>(start.pricesIncludeVat ?? null);
  const [documentDate, setDocumentDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState<'BANK' | 'CASH'>('BANK');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  // MUT-711: the allocation number requested by hand, when MTB3A can't request it.
  const [allocationInput, setAllocationInput] = useState('');
  // MUT-643: what happened to the part of a credit note the client already paid.
  const [paidChoice, setPaidChoice] = useState<'REFUND' | 'KEEP' | null>(null);
  const [refundedOn, setRefundedOn] = useState(today);
  const [refundMethod, setRefundMethod] = useState<'BANK' | 'CASH'>('BANK');
  const [refundReference, setRefundReference] = useState('');
  const pricesIncludeVat = vatIncluded ?? issuer.data?.pricesIncludeVat ?? false;
  const language_ = (issuer.data?.defaultLanguage ?? 'he') as IssueDocumentRequest['language'];
  const takesPayment = docType === 'TAX_INVOICE_RECEIPT' || docType === 'RECEIPT';
  // MUT-662: a payment request falls due like a tax invoice.
  const hasDueDate = docType === 'TAX_INVOICE' || docType === 'PAYMENT_REQUEST';
  // An exempt dealer issues receipts only (the issuer is loaded before this form renders, so the first type is right).
  // MUT-660 (N1): money received with no client takes its invoice-receipt with no client (linked to the entry).
  const noClientEntry = start.fromEntry?.kind === 'received' && !start.customerId;
  const needsCustomer = docType !== 'RECEIPT' && !noClientEntry;

  // The due date follows the profile's payment terms once the issuer is read.
  const terms = issuer.data?.paymentTermsDays;
  const [termsApplied, setTermsApplied] = useState(false);
  if (!termsApplied && issuer.data) {
    setTermsApplied(true);
    if (terms != null) setDueDate(addDays(today, terms));
  }

  const discountInvalid = (l: Line) => !!l.discount.trim() && money(l.discount) === null;
  const linesValid = lines.length > 0 && lines.every((l) => l.description.trim() && positiveQuantity(l.quantity) && money(l.unitPrice) !== null && !discountInvalid(l));
  const body: IssueDocumentRequest | null =
    linesValid && (!needsCustomer || customerId)
      ? {
          docType,
          documentDate,
          currency: 'ILS',
          language: language_,
          ...(customerId ? { customerId } : {}),
          ...(hasDueDate && dueDate ? { dueDate } : {}),
          ...(start.originalId && docType === 'CREDIT_NOTE' ? { originalId: start.originalId } : {}),
          ...(start.appliesToDocumentId && takesPayment ? { appliesToDocumentId: start.appliesToDocumentId } : {}),
          // A Received this document takes over already says how the money came in.
          ...(takesPayment && start.fromEntry?.kind !== 'received' ? { payment: { method, reference: reference.trim() || null, receivedOn } } : {}),
          ...(start.fromEntry ? { fromEntry: start.fromEntry } : {}),
          pricesIncludeVat,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          lines: lines.map((l) => ({
            description: l.description.trim(),
            kind: l.kind,
            quantity: l.quantity.trim(),
            unitPrice: money(l.unitPrice)!,
            ...(l.discount.trim() ? { discount: money(l.discount)! } : {}),
            ...(l.pricesIncludeVat !== undefined ? { pricesIncludeVat: l.pricesIncludeVat } : {}),
            ...(l.vatExempt ? { vatExempt: true } : {}),
          })),
        }
      : null;

  // The totals ask the server again a moment after typing stops.
  const [asked, setAsked] = useState<IssueDocumentRequest | null>(null);
  const serialized = JSON.stringify(body);
  useEffect(() => {
    const timer = window.setTimeout(() => setAsked(body), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the serialized body is the dependency
  }, [serialized]);
  const preview = useDocumentPreview(profile.id, asked);
  const [drafting, setDrafting] = useState(false);
  // MUT-643 (ADR-276): the preview says how much of this credit note the client already paid; that part needs a choice.
  const paidPart = docType === 'CREDIT_NOTE' ? (preview.data?.creditNote?.paid ?? null) : null;
  const hasPaidPart = paidPart !== null && /[1-9]/.test(paidPart) && !paidPart.startsWith('-');
  const awaitingPaidChoice = hasPaidPart && paidChoice === null;
  const withPaidPart = (b: IssueDocumentRequest): IssueDocumentRequest =>
    hasPaidPart && paidChoice
      ? { ...b, paidPart: paidChoice === 'KEEP' ? { mode: 'KEEP' } : { mode: 'REFUND', refundedOn: refundedOn < documentDate ? documentDate : refundedOn, method: refundMethod, reference: refundReference.trim() || null } }
      : b;

  const setLine = (index: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  // Review fix: a refusal of an earlier attempt goes once the draft changes.
  const [issuedFor, setIssuedFor] = useState(serialized);
  if (issue.error && issuedFor !== serialized) {
    setIssuedFor(serialized);
    issue.reset();
  }
  const refusal = issue.error ?? preview.error;
  // MUT-731 (wireframe 2): Starter's 3 documents a month. Known before the person types (the month's usage), so the
  // drawer opens with the notice in the banner slot, its fields dimmed, and Upgrade to Solo in Issue's place; the
  // server's PLAN_LIMIT shows the same notice if it races. A receipt paying an issued document is never refused.
  const starter = useStarterUsage();
  const knownLimit = starter.usage && documentRefusedNow(starter.usage, docType, start.appliesToDocumentId) && starter.billing ? limitFromUsage(starter.usage, 'documents', starter.billing) : null;
  const planLimit = planLimitOf(issue.error) ?? knownLimit;
  // MUT-710 (D10): the two-step refusal is the prompt at the top, never the general failure.
  const refusalText = isTwoFactorRefusal(refusal) || planLimitOf(refusal) ? null : refusal instanceof ApiError ? refusalMessage(refusal, t) : refusal ? t('hosted.issue.failed') : null;

  // MUT-711 (ADR-273): the preview says the invoice needs an allocation number MTB3A can't request. Issue waits for a
  // well-formed number, sent with the invoice number it was requested for (a preview, never a reservation).
  const allocation = preview.data?.allocation ?? null;
  const manual = allocation?.mode === 'MANUAL' ? allocation : null;
  const allocationNumber = manual ? allocationDigits(allocationInput) : null;
  const awaitingAllocation = !!manual && allocationNumber === null;
  const allocationInvalid = !!manual && allocationNumber === null && (allocationInput.trim() !== '' || tried);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!body || awaitingAllocation || awaitingPaidChoice) return;
    const chosen = withPaidPart(body);
    const sent: IssueDocumentRequest = manual && allocationNumber ? { ...chosen, manualAllocation: { number: allocationNumber, forNumber: manual.nextNumber } } : chosen;
    setIssuedFor(serialized);
    issue.mutate(
      { body: sent, key: attempt.keyFor(sent) },
      {
        onSuccess: (doc) => {
          attempt.succeeded();
          onIssued(doc);
        },
        onError: (error) => {
          // AC3: another document took the number; the one entered was requested for it, so it can't be used.
          if (error instanceof ApiError && apiErrorReason(error) === 'ALLOCATION_NUMBER_MOVED') {
            setAllocationInput('');
            void preview.refetch();
          }
        },
      },
    );
  };

  const draftPdf = async () => {
    if (!body) return;
    setDrafting(true);
    try {
      openPdf(await api.draftPdf(profile.id, body), 'draft.pdf');
    } catch {
      toast(t('hosted.issue.pdfFailed'));
    } finally {
      setDrafting(false);
    }
  };

  const typeLabel = (type: IssuedDocType) => t(`hosted.issue.types.${type}`);
  // Linked to an entry (I1-a): an Owed takes a tax invoice, a Received an invoice-receipt or a receipt (review fix).
  // MUT-662: an Owed may also take a payment request (an exempt dealer's only document for one).
  const entryTypes: IssuedDocType[] | null = start.fromEntry ? (start.fromEntry.kind === 'owed' ? (exempt ? ['PAYMENT_REQUEST'] : ['TAX_INVOICE', 'PAYMENT_REQUEST']) : exempt ? ['RECEIPT'] : ['TAX_INVOICE_RECEIPT', 'RECEIPT']) : null;
  const allowedTypes = entryTypes ?? (exempt ? (['RECEIPT', 'PAYMENT_REQUEST'] as IssuedDocType[]) : TYPES.filter((type) => type !== 'CREDIT_NOTE' || start.originalId));
  // The entry fixes the client and the amount: those stay as they are (the server refuses a mismatch).
  const linked = !!start.fromEntry;
  const blocked = setup.data ? !setup.data.canIssue : false;

  return (
    <Drawer
      title={t('hosted.issue.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      readOnly={!writable}
      footer={
        blocked ? undefined : (
          <div className="hp-issue-footer">
            <p className="hp-issue-final">{t('hosted.issue.final')}</p>
            {starter.usage && <DocumentsLeftLine meter={starter.usage.documents} canUpgrade={starter.canUpgrade} />}
            {planLimit ? (
              <div className="drawer-footer-right">
                <Button type="button" variant="secondary" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                {upgradeOffered(planLimit) && <UpgradeToSolo />}
              </div>
            ) : (
            <div className="drawer-footer-right">
              <Button type="button" variant="secondary" onClick={() => void draftPdf()} disabled={!body || drafting}>
                {t('hosted.issue.draftPdf')}
              </Button>
              <Button
                type="submit"
                form={formId}
                isLoading={issue.isPending}
                keepLabelWhileLoading
                disabled={awaitingAllocation || awaitingPaidChoice}
                aria-describedby={awaitingAllocation ? `${formId}-allocation-note` : awaitingPaidChoice ? `${formId}-paid-part` : undefined}
                data-testid="issue-submit"
              >
                {t('hosted.issue.issueAs', { type: typeLabel(docType) })}
              </Button>
            </div>
            )}
          </div>
        )
      }
    >
      {blocked ? (
        <div className="hp-issue-blocked" role="status" data-testid="issue-blocked">
          <p>{t('hosted.invoicing.blocked', { steps: setup.data!.missing.map((m) => t(`hosted.invoicing.steps.${m === 'DETAILS' ? 'details' : 'numbering'}`)).join(' · ') })}</p>
          <Link className="hp-link" to={`/p/${profile.id}/you/invoicing`}>
            {t('hosted.issue.openSetup')}
          </Link>
        </div>
      ) : (
        <form id={formId} className="hp-issue-form" onSubmit={submit} noValidate data-refused={planLimit ? 'true' : undefined}>
          {planLimit && <PlanLimitNotice limit={planLimit} withUpgrade={false} />}
          <TwoFactorIssuingPrompt error={issue.error} />
          {needsCustomer && (
            <div className="hp-issue-field">
              <label htmlFor={`${formId}-client`} className="hp-issue-label">
                {t('hosted.issue.client')}
              </label>
              <ClientPicker
                id={`${formId}-client`}
                profileId={profile.id}
                value={customerId}
                onChange={setCustomerId}
                disabled={linked}
                placeholder={t('hosted.issue.clientPlaceholder')}
                canCreate={canAddClient(profile, writable)}
              />
              {tried && !customerId && <p className="input-error-message">{t('hosted.issue.clientRequired')}</p>}
            </div>
          )}

          <div className="hp-issue-field">
            <span id={`${formId}-type`} className="hp-issue-label">
              {t('hosted.issue.type')}
            </span>
            <SegmentedControl labelledBy={`${formId}-type`} value={docType} options={allowedTypes.map((type) => ({ value: type, label: typeLabel(type) }))} onChange={setDocType} />
            {docType === 'PAYMENT_REQUEST' && (
              <p className="hp-muted" data-testid="issue-payment-request-note">
                {t('hosted.issue.paymentRequestNote')}
              </p>
            )}
          </div>

          <section className="hp-issue-lines" aria-labelledby={`${formId}-lines`}>
            <div className="hp-issue-lines-head">
              <h3 id={`${formId}-lines`}>{t('hosted.issue.lines')}</h3>
              <label className="hp-issue-switch">
                <input type="checkbox" checked={pricesIncludeVat} disabled={linked} onChange={(e) => setVatIncluded(e.target.checked)} />
                <span>{t('hosted.issue.pricesIncludeVat')}</span>
              </label>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="hp-issue-line" data-testid={`issue-line-${i}`}>
                <Input
                  label={t('hosted.issue.description')}
                  id={`${formId}-desc-${i}`}
                  value={line.description}
                  dir="auto"
                  maxLength={DESCRIPTION_MAX}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  error={tried && !line.description.trim() ? t('hosted.issue.descriptionRequired') : undefined}
                />
                <div className="hp-issue-line-numbers">
                  <Input
                    label={t('hosted.issue.quantity')}
                    id={`${formId}-qty-${i}`}
                    value={line.quantity}
                    dir="ltr"
                    inputMode="decimal"
                    readOnly={linked}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                    error={tried && !positiveQuantity(line.quantity) ? t('hosted.issue.numberInvalid') : undefined}
                  />
                  <Input
                    label={t('hosted.issue.price')}
                    id={`${formId}-price-${i}`}
                    value={line.unitPrice}
                    dir="ltr"
                    inputMode="decimal"
                    readOnly={linked}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                    error={tried && money(line.unitPrice) === null ? t('hosted.issue.numberInvalid') : undefined}
                  />
                  <span className="hp-issue-line-net" aria-live="polite">
                    {preview.data?.lines[i] ? formatDecimal(preview.data.lines[i].net, 'ILS', language) : ''}
                  </span>
                </div>
                <div className="hp-issue-line-actions">
                  <Button type="button" variant="ghost" size="sm" aria-expanded={openLine === i} onClick={() => setOpenLine(openLine === i ? null : i)}>
                    {t('hosted.issue.lineOptions')}
                  </Button>
                  {lines.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      {t('hosted.issue.removeLine')}
                    </Button>
                  )}
                </div>
                {(openLine === i || discountInvalid(line)) && (
                  <div className="hp-issue-line-options">
                    <Select label={t('hosted.issue.kind')} id={`${formId}-kind-${i}`} value={line.kind} onChange={(e) => setLine(i, { kind: e.target.value as Line['kind'] })}>
                      <option value="SERVICE">{t('hosted.issue.kinds.SERVICE')}</option>
                      <option value="GOODS">{t('hosted.issue.kinds.GOODS')}</option>
                    </Select>
                    <Input
                      label={t('hosted.issue.lineDiscount')}
                      id={`${formId}-disc-${i}`}
                      value={line.discount}
                      dir="ltr"
                      inputMode="decimal"
                      onChange={(e) => setLine(i, { discount: e.target.value })}
                      error={discountInvalid(line) ? t('hosted.issue.numberInvalid') : undefined}
                    />
                    <label className="hp-issue-switch">
                      <input type="checkbox" checked={line.pricesIncludeVat ?? pricesIncludeVat} onChange={(e) => setLine(i, { pricesIncludeVat: e.target.checked })} />
                      <span>{t('hosted.issue.linePriceIncludesVat')}</span>
                    </label>
                    <label className="hp-issue-switch">
                      <input type="checkbox" checked={line.vatExempt ?? false} onChange={(e) => setLine(i, { vatExempt: e.target.checked })} />
                      <span>{t('hosted.issue.lineExempt')}</span>
                    </label>
                  </div>
                )}
              </div>
            ))}
            {!linked && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>
                {t('hosted.issue.addLine')}
              </Button>
            )}
          </section>

          <div className="hp-issue-dates">
            <Input label={t('hosted.issue.date')} id={`${formId}-date`} type="date" value={documentDate} max={today} onChange={(e) => setDocumentDate(e.target.value)} />
            {hasDueDate && <Input label={t('hosted.issue.dueDate')} id={`${formId}-due`} type="date" value={dueDate} min={documentDate} onChange={(e) => setDueDate(e.target.value)} />}
          </div>

          {takesPayment && start.fromEntry?.kind !== 'received' && (
            <section className="hp-issue-payment" aria-labelledby={`${formId}-payment`}>
              <h3 id={`${formId}-payment`}>{t('hosted.issue.payment')}</h3>
              <SegmentedControl
                ariaLabel={t('hosted.issue.method')}
                value={method}
                options={[
                  { value: 'BANK', label: t('hosted.issue.methods.BANK') },
                  { value: 'CASH', label: t('hosted.issue.methods.CASH') },
                ]}
                onChange={setMethod}
              />
              <Input label={t('hosted.issue.reference')} id={`${formId}-ref`} value={reference} dir="ltr" maxLength={100} onChange={(e) => setReference(e.target.value)} />
              <Input label={t('hosted.issue.receivedOn')} id={`${formId}-received`} type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} />
            </section>
          )}

          {hasPaidPart && (
            <section className="hp-issue-payment" aria-labelledby={`${formId}-paid-part`} data-testid="issue-paid-part">
              <h3 id={`${formId}-paid-part`}>{t('hosted.issue.creditPaid.title', { amount: formatDecimal(paidPart!, 'ILS', language) })}</h3>
              <SegmentedControl
                ariaLabel={t('hosted.issue.creditPaid.choice')}
                value={paidChoice ?? ''}
                options={[
                  { value: 'REFUND', label: t('hosted.issue.creditPaid.refunded') },
                  { value: 'KEEP', label: t('hosted.issue.creditPaid.kept') },
                ]}
                onChange={(value) => setPaidChoice(value as 'REFUND' | 'KEEP')}
              />
              {paidChoice === 'REFUND' && (
                <>
                  <SegmentedControl
                    ariaLabel={t('hosted.issue.method')}
                    value={refundMethod}
                    options={[
                      { value: 'BANK', label: t('hosted.issue.methods.BANK') },
                      { value: 'CASH', label: t('hosted.issue.methods.CASH') },
                    ]}
                    onChange={setRefundMethod}
                  />
                  <Input label={t('hosted.issue.creditPaid.refundedOn')} id={`${formId}-refunded-on`} type="date" value={refundedOn < documentDate ? documentDate : refundedOn} min={documentDate} max={today} onChange={(e) => setRefundedOn(e.target.value)} />
                  <Input label={t('hosted.issue.reference')} id={`${formId}-refund-ref`} value={refundReference} dir="ltr" maxLength={100} onChange={(e) => setRefundReference(e.target.value)} />
                </>
              )}
              {tried && awaitingPaidChoice && <p className="input-error-message">{t('hosted.issue.creditPaid.required')}</p>}
            </section>
          )}

          <Input label={t('hosted.issue.notes')} id={`${formId}-notes`} value={notes} dir="auto" maxLength={500} onChange={(e) => setNotes(e.target.value)} />

          {manual && (
            <ManualAllocationPanel
              allocation={manual}
              value={allocationInput}
              onChange={setAllocationInput}
              invalid={allocationInvalid}
              inputId={`${formId}-allocation`}
              onChangeAmount={() => document.getElementById(`${formId}-price-0`)?.focus()}
            />
          )}

          <dl className="hp-issue-totals" data-testid="issue-totals" aria-live="polite">
            <div>
              <dt>{t('hosted.issue.net')}</dt>
              <dd>{preview.data ? formatDecimal(preview.data.net, 'ILS', language) : '—'}</dd>
            </div>
            <div>
              <dt>{t('hosted.issue.vat', { rate: preview.data ? String(preview.data.vatRateBasisPoints / 100) : '' })}</dt>
              <dd>{preview.data ? formatDecimal(preview.data.vat, 'ILS', language) : '—'}</dd>
            </div>
            <div className="hp-issue-gross">
              <dt>{t('hosted.issue.gross')}</dt>
              <dd>{preview.data ? formatDecimal(preview.data.gross, 'ILS', language) : '—'}</dd>
            </div>
          </dl>
          {refusalText && (
            <p className="input-error-message" role="alert">
              {refusalText}
            </p>
          )}
        </form>
      )}
    </Drawer>
  );
}

function addDays(isoDate: string, days: number): string {
  // Not an amount: a calendar date's parts, already YYYY-MM-DD.
  // eslint-disable-next-line no-restricted-syntax
  const [y, m, d] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

/** The server's refusals the person can act on, in words; anything else is the general failure. */
function refusalMessage(error: ApiError, t: (key: string, vars?: Record<string, string>) => string): string {
  const reason = apiErrorReason(error);
  // MUT-647: the entry already has an invoice issued elsewhere; MTB3A issues none for it while it is attached.
  if (reason === 'EXTERNAL_INVOICE_ATTACHED') return t('hosted.issue.refusals.EXTERNAL_INVOICE_ATTACHED', { number: String((error.details as { number?: unknown }).number ?? '') });
  // MUT-711 (AC3): the previewed number was taken first; the allocation number must be requested again for the new one.
  if (reason === 'ALLOCATION_NUMBER_MOVED') return t('hosted.issue.refusals.ALLOCATION_NUMBER_MOVED', { next: String((error.details as { next?: unknown }).next ?? '') });
  // MUT-643: the credit notes on the original reached its total; `maximum` is in minor units.
  if (reason === 'CREDIT_EXCEEDS_ORIGINAL') return t('hosted.issue.refusals.CREDIT_EXCEEDS_ORIGINAL', { maximum: minorDigitsToDecimal(String((error.details as { maximum?: unknown }).maximum ?? '0'), 2) });
  const known = [
    'ENTRY_MISMATCH',
    'DATE_BEFORE_LAST_DOCUMENT',
    'ORIGINAL_PAID',
    'EXCEEDS_OUTSTANDING',
    'ISSUING_SETUP_INCOMPLETE',
    'DATE_BEFORE_ORIGINAL',
    'QUANTITY_INVALID',
    'DISCOUNT_INVALID',
    'TOTAL_NOT_POSITIVE',
    'EXEMPT_DEALER_TAX_INVOICE',
    'ALLOCATION_NUMBER_REQUIRED',
    'ALLOCATION_NUMBER_INVALID',
    'ALLOCATION_NOT_NEEDED',
    'TAX_AUTHORITY_NOT_CONNECTED',
    // MUT-643
    'DATE_BEFORE_CREDIT_NOTE',
    'ORIGINAL_CHANGED',
  ];
  if (reason && known.includes(reason)) return t(`hosted.issue.refusals.${reason}`);
  return t('hosted.issue.failed');
}

/**
 * MUT-731 (wireframe 7): the documents meter speaks where it's used, in the Issue drawer's footer: "1 of 3 documents
 * this month" at ok, then what's left (butter), with Upgrade to Solo from 90%.
 */
function DocumentsLeftLine({ meter, canUpgrade }: { meter: StarterMeter; canUpgrade: boolean }) {
  const { t } = useLanguage();
  return (
    <p className="hp-issue-usage" data-level={meter.level} data-testid="issue-usage">
      {meter.level === 'ok' ? t('hosted.billing.usage.thisMonth', { usage: t('hosted.billing.usage.documents', { used: String(meter.used), cap: String(meter.limit) }) }) : <LeftLine meter={meter} />}
      {(meter.level === 'nudge' || meter.level === 'at_cap') && canUpgrade && (
        <>
          {' · '}
          <UpgradeToSolo asLink />
        </>
      )}
    </p>
  );
}
