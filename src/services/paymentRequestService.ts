import { documentRepo, transactionRepo } from '../db/repository';
import type { Document, Transaction, DocumentStatus } from '../types';

interface CreatePaymentRequestParams {
  documentData: Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'linkedTransactionIds'>;
}

/**
 * Creates a Payment Request document and automatically creates a linked receivable transaction.
 * Payment Requests are NOT tax documents and create unpaid income (receivables).
 */
export async function createPaymentRequestWithReceivable(
  params: CreatePaymentRequestParams
): Promise<{ document: Document; transaction: Transaction }> {
  const { documentData } = params;

  // 1. Create the document with type payment_request and status issued
  const document = await documentRepo.create({
    ...documentData,
    type: 'payment_request',
    status: 'issued' as DocumentStatus,
    linkedTransactionIds: [],
  });

  // 2. Create linked receivable transaction (income, unpaid)
  const transaction = await transactionRepo.create({
    kind: 'income',
    status: 'unpaid',
    title: document.subject || `Payment Request ${document.number}`,
    clientId: documentData.clientId,
    amountMinor: documentData.totalMinor,
    currency: documentData.currency,
    occurredAt: documentData.issueDate,
    dueDate: documentData.dueDate || documentData.issueDate,
    linkedDocumentId: document.id,
  });

  // 3. Link transaction to document
  await documentRepo.linkTransactions(document.id, [transaction.id]);

  return { document, transaction };
}

/**
 * Records payment for a Payment Request document.
 * Marks all linked transactions as paid and updates document status.
 */
export async function recordPaymentForRequest(
  documentId: string,
  paidAt: string
): Promise<void> {
  const document = await documentRepo.get(documentId);
  if (!document || document.type !== 'payment_request') {
    throw new Error('Invalid payment request document');
  }

  if (document.status === 'paid') {
    throw new Error('Payment request is already paid');
  }

  if (document.status === 'voided') {
    throw new Error('Cannot record payment for voided document');
  }

  // Mark all linked transactions as paid
  for (const txId of document.linkedTransactionIds) {
    const tx = await transactionRepo.get(txId);
    if (tx && tx.status === 'unpaid') {
      await transactionRepo.update(txId, {
        status: 'paid',
        paidAt,
      });
    }
  }

  // Mark document as paid
  await documentRepo.markPaid(documentId);
}

/**
 * Voids a Payment Request document.
 * Soft-deletes linked transactions and marks document as voided.
 */
export async function voidPaymentRequest(documentId: string): Promise<void> {
  const document = await documentRepo.get(documentId);
  if (!document || document.type !== 'payment_request') {
    throw new Error('Invalid payment request document');
  }

  if (document.status === 'paid') {
    throw new Error('Cannot void a paid payment request');
  }

  // Soft-delete linked transactions
  for (const txId of document.linkedTransactionIds) {
    await transactionRepo.softDelete(txId);
  }

  // Void the document
  await documentRepo.markVoided(documentId);
}

/**
 * Updates a Payment Request document and its linked transaction.
 * Only allowed if document is not locked.
 */
export async function updatePaymentRequestWithTransaction(
  documentId: string,
  documentData: Partial<Document>
): Promise<void> {
  const document = await documentRepo.get(documentId);
  if (!document || document.type !== 'payment_request') {
    throw new Error('Invalid payment request document');
  }

  if (document.lockedAt) {
    throw new Error('Cannot update locked payment request');
  }

  // Update document
  await documentRepo.update(documentId, documentData);

  // If amount or dates changed, update linked transactions
  if (document.linkedTransactionIds.length > 0) {
    const txUpdates: Partial<Transaction> = {};

    if (documentData.totalMinor !== undefined) {
      txUpdates.amountMinor = documentData.totalMinor;
    }
    if (documentData.currency !== undefined) {
      txUpdates.currency = documentData.currency;
    }
    if (documentData.issueDate !== undefined) {
      txUpdates.occurredAt = documentData.issueDate;
    }
    if (documentData.dueDate !== undefined) {
      txUpdates.dueDate = documentData.dueDate;
    }
    if (documentData.subject !== undefined) {
      txUpdates.title = documentData.subject;
    }
    if (documentData.clientId !== undefined) {
      txUpdates.clientId = documentData.clientId;
    }

    // Only update if there are changes
    if (Object.keys(txUpdates).length > 0) {
      for (const txId of document.linkedTransactionIds) {
        const tx = await transactionRepo.get(txId);
        // Only update unpaid transactions
        if (tx && tx.status === 'unpaid') {
          await transactionRepo.update(txId, txUpdates);
        }
      }
    }
  }
}
