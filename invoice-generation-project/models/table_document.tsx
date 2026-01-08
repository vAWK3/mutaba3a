import { DocumentStatus, IssuedDocumentType } from "@/types";

export const isDocumentCompletable = (type: string, status: DocumentStatus) => {
  if (
    type === IssuedDocumentType.Invoice ||
    type === IssuedDocumentType.InvoiceReceipt
  ) {
    return (
      status === DocumentStatus.Pending || status === DocumentStatus.Overdue
    );
  }
  return false;
};
