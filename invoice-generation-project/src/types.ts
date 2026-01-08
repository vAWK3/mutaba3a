export enum Language {
  ar = "العربية",
  en = "English",
  he = "עברית",
}

export enum Currency {
  Shekel = "₪",
  Dollar = "$",
}

export enum BusinessType {
  EXEMPT = "exempt",
  AUTHORIZED = "authorized",
  COMPANY = "company",
  LAWYER = "lawyer",
  NONE = "none",
}

export enum PaymentTerms {
  IMMEDIATE = "immediate",
  CURRENT = "current",
  CURRENT30 = "current30",
  CURRENT45 = "current45",
  CURRENT60 = "current60",
}

export enum PaymentMethod {
  CASH = "cash",
  BANK = "bank_transfer",
  CHEQUE = "cheque",
  CREDIT = "credit_card",
  OTHER = "other",
}

export enum NewDocumentType {
  Invoice = "invoice",
  Receipt = "receipt",
  InvoiceReceipt = "invoice_receipt",
  PriceOffer = "price_offer",
  ProformaInvoice = "proforma_invoice",
  DonationReceipt = "donation_receipt",

}

export enum IssuedDocumentType {
  Invoice = "invoice",
  Receipt = "receipt",
  InvoiceReceipt = "invoice_receipt",
  CreditNote = "credit_note",
  PriceOffer = "price_offer",
  ProformaInvoice = "proforma_invoice",
  DonationReceipt = "donation_receipt",
}

export enum DocumentStatus {
  Paid = "Paid",
  Pending = "Pending",
  Overdue = "Overdue",
}

export interface MultilingualFormData<T> {
  en: boolean;
  ar: boolean;
  he: boolean;
  data: T;
}


export interface Address {
  address1En?: string;
  address1Ar?: string;
  address1He?: string;
  address2En?: string;
  address2Ar?: string;
  address2He?: string;
  postalCode?: string;
  cityEn?: string;
  cityAr?: string;
  cityHe?: string;
  countryEn?: string;
  countryAr?: string;
  countryHe?: string;
}

export interface ProfileData {
  id?: number;
  userId?: string;
  businessType: BusinessType | null;
  nameEn?: string;
  nameAr?: string;
  nameHe?: string;
  email: string;
  taxId?: string;
  phoneNumber?: string;
  logoUrl?: File | string;
  businessCertificate?: File | string;
  address: Address;
  color?: string;
}

export interface DocumentSettings {
  payment?: PaymentTerms;
  currency?: Currency;
  language?: Language;
  discount?: number;
}

export interface ClientAdditionalData {
  numberOfDocuments: number;
  outstandingInvoices: number;
  lastContactDate: Date;
}

export interface ClientData {
  name: string;
  taxId?: string | null;
  externalIdentifier?: string;
  email: string;
  phoneNumber?: string;
  address: Address;
  businessProfile: number;
  refNumber?: string;
  color?: string;
  document?: DocumentSettings;
  data?: ClientAdditionalData;
  id?: string;
  paymentTerms?: PaymentTerms;
}
export interface DocumentItem {
  name: string;
  quantity: number;
  rate: number;
  rateVat: number;
  discount: number;
  taxExempt: boolean;
}
export interface DocumentData {
  id?: string;
  client?: ClientData;
  clientId?: string;
  subject?: string;
  settings: DocumentSettings;
  issueDate: Date;
  dueDate?: Date;
  paidDate?: Date,
  brief?: string;
  items: DocumentItem[];
  discount: number;
  notes?: string;
  refDocumentId?: string;
  number?: string;
  type: NewDocumentType | IssuedDocumentType;
  subtotal: number;
  tax: number;
  total: number;
  status?: DocumentStatus;
  payment?: DocumentPayment[];
}

export interface DocumentPayment {
  id?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  details: Record<string, any>;
  notes?: string;
}

export interface SubscriptionPlan {
  id: string;
  plan: FaturaPlan
  isActive: boolean;
  startDate: Date;
  endDate: Date;
  currentDocs: number;
  discount: number;
}

export interface FaturaPlan {
  id: string;
  nameEn: string;
  nameAr: string;
  price: number;
  maxDocs: number;
  maxClients: number;
  analytics: boolean;
  importExport: boolean;
  invoiceCustomization: boolean;
}

export interface UpdateModel {
  id: string;
  timestamp: Date;
  version: string;
  features: string[];
}

export interface UserModel {
  id: string;
  full_name: string;
  email: string;
}

export interface NewDocumentData {
  type: IssuedDocumentType;
  client: ClientData | undefined;

}