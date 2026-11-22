import type { IssuedDocumentRecord } from '../../../repositories/ports.js';
import { PDF_LABELS } from '../labels.js';
import type { SigningKey } from './cms.js';
import { devSigningAuthority, kmsSigningKey, type KmsApi } from './keys.js';
import { signPdf, type SignatureDetails } from './pdf.js';
import { localTimestamper, rfc3161Timestamper, type BinaryPost, type Timestamper } from './timestamp.js';

/**
 * MUT-641 (ADR-265): every issued-document PDF that leaves the system is signed, so the file sent is the legal original
 * (Instruction 18B). Which key signs is configuration (ISSUING_SIGNER); the routes only see a DocumentSigner, or null
 * when this server has none, and then refuse to hand out a file rather than send it unsigned.
 */
export interface DocumentSigner {
  /** dev | kms: which kind of key signs, for logs. */
  readonly kind: 'dev' | 'kms';
  sign(pdf: Uint8Array, details: SignatureDetails): Promise<Uint8Array>;
}

export function documentSigner(kind: DocumentSigner['kind'], key: () => Promise<SigningKey>, timestamper: Timestamper): DocumentSigner {
  return { kind, sign: async (pdf, details) => signPdf(pdf, details, await key(), timestamper) };
}

/** Development, tests and QA: this process's throwaway authority signs and time-stamps. */
export function devDocumentSigner(timestamper?: Timestamper): DocumentSigner {
  return documentSigner('dev', async () => (await devSigningAuthority()).signer, timestamper ?? localTimestamper(async () => (await devSigningAuthority()).timestampAuthority));
}

export interface SignerConfig {
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  ISSUING_SIGNER?: 'dev' | 'kms' | 'off' | undefined;
  ISSUING_SIGNING_KMS_KEY?: string | undefined;
  ISSUING_SIGNING_CERT_CHAIN?: string | undefined;
  ISSUING_TSA_URL?: string | undefined;
  ISSUING_SIGNING_TIMEOUT_MS: number;
}

/** The signer this server's configuration names; null = none (production until the certificate is in place). */
export function documentSignerFrom(config: SignerConfig, io: { kms?: KmsApi; tsaPost?: BinaryPost } = {}): DocumentSigner | null {
  const kind = config.ISSUING_SIGNER ?? (config.NODE_ENV === 'production' ? 'off' : 'dev');
  const tsa = config.ISSUING_TSA_URL ? rfc3161Timestamper(config.ISSUING_TSA_URL, { timeoutMs: config.ISSUING_SIGNING_TIMEOUT_MS, ...(io.tsaPost ? { post: io.tsaPost } : {}) }) : undefined;
  if (kind === 'off') return null;
  if (kind === 'dev') return devDocumentSigner(tsa);
  // loadConfig makes sure a kms signer has its key, its chain and a time-stamp authority.
  const key = kmsSigningKey({ keyVersion: config.ISSUING_SIGNING_KMS_KEY!, chainPem: config.ISSUING_SIGNING_CERT_CHAIN!, timeoutMs: config.ISSUING_SIGNING_TIMEOUT_MS, ...(io.kms ? { kms: io.kms } : {}) });
  return documentSigner('kms', async () => key, tsa!);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The signature panel's words: in the document's language, naming the business the document was issued for. */
export function signatureDetailsOf(doc: IssuedDocumentRecord, signedAt: Date): SignatureDetails {
  const labels = PDF_LABELS[doc.language as keyof typeof PDF_LABELS] ?? PDF_LABELS.he;
  const business = text(doc.issuer['legalName']) ?? '';
  const city = text(doc.issuer['city']);
  return { reason: labels.signedOnBehalf(business, text(doc.issuer['vatId'])), name: business, ...(city ? { location: city } : {}), signedAt };
}

export type { SignatureDetails } from './pdf.js';
