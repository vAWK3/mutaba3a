import type { X509Certificate } from 'node:crypto';
import type { Config } from '../../../config.js';
import type { IssuedDocumentRecord } from '../../../repositories/ports.js';
import { PDF_LABELS } from '../labels.js';
import type { SigningKey } from './cms.js';
import { devSigningAuthority, kmsSigningKey, signingChain, type KmsApi } from './keys.js';
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
  /** The signer's own certificate (kms), for the boot log and its expiry warning. */
  readonly certificate?: X509Certificate;
  sign(pdf: Uint8Array, details: SignatureDetails): Promise<Uint8Array>;
}

export function documentSigner(kind: DocumentSigner['kind'], key: () => Promise<SigningKey>, timestamper: Timestamper, certificate?: X509Certificate): DocumentSigner {
  return { kind, ...(certificate ? { certificate } : {}), sign: async (pdf, details) => signPdf(pdf, details, await key(), timestamper) };
}

/** Development, tests and QA: this process's throwaway authority signs and time-stamps. */
export function devDocumentSigner(timestamper?: Timestamper): DocumentSigner {
  return documentSigner('dev', async () => (await devSigningAuthority()).signer, timestamper ?? localTimestamper(async () => (await devSigningAuthority()).timestampAuthority));
}

export type SignerConfig = Pick<Config, 'NODE_ENV' | 'ISSUING_SIGNER' | 'ISSUING_SIGNING_KMS_KEY' | 'ISSUING_SIGNING_CERT_CHAIN' | 'ISSUING_TSA_URL' | 'ISSUING_SIGNING_TIMEOUT_MS'>;

/** The signer this server's configuration names; null = none (production until the certificate is in place). */
export function documentSignerFrom(config: SignerConfig, io: { kms?: KmsApi; tsaPost?: BinaryPost } = {}): DocumentSigner | null {
  const kind = config.ISSUING_SIGNER ?? (config.NODE_ENV === 'production' ? 'off' : 'dev');
  const tsa = config.ISSUING_TSA_URL ? rfc3161Timestamper(config.ISSUING_TSA_URL, { timeoutMs: config.ISSUING_SIGNING_TIMEOUT_MS, ...(io.tsaPost ? { post: io.tsaPost } : {}) }) : undefined;
  if (kind === 'off') return null;
  if (kind === 'dev') return devDocumentSigner(tsa);
  // loadConfig makes sure a kms signer has its key, its chain and a time-stamp authority.
  const key = kmsSigningKey({ keyVersion: config.ISSUING_SIGNING_KMS_KEY!, chainPem: config.ISSUING_SIGNING_CERT_CHAIN!, timeoutMs: config.ISSUING_SIGNING_TIMEOUT_MS, ...(io.kms ? { kms: io.kms } : {}) });
  return documentSigner('kms', async () => key, tsa!, signingChain(config.ISSUING_SIGNING_CERT_CHAIN!)[0]);
}

/** Within this many days of its certificate's end, the server warns at every start (MUT-641 review). */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

/** What the boot log says about the signer: who signs, until when, and whether that end is near or past. */
export function signerStatus(signer: DocumentSigner, now: Date): { level: 'info' | 'warn' | 'error'; message: string; details: Record<string, unknown> } {
  const cert = signer.certificate;
  if (!cert) return { level: 'info', message: `issued-document PDFs are signed by the ${signer.kind} signer`, details: { signer: signer.kind } };
  const validTo = new Date(cert.validTo);
  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
  const details = { signer: signer.kind, subject: cert.subject.replace(/\n/g, ', '), fingerprint256: cert.fingerprint256, validTo: validTo.toISOString(), daysLeft };
  if (daysLeft < 0 || now < new Date(cert.validFrom)) return { level: 'error', message: 'the signing certificate is not valid now: issued-document PDFs answer 503 SIGNING_NOT_CONFIGURED until it is replaced', details };
  if (daysLeft <= CERTIFICATE_EXPIRY_WARNING_DAYS) return { level: 'warn', message: `the signing certificate ends in ${daysLeft} days: renew it (docs/operations/before-release.md, MUT-641)`, details };
  return { level: 'info', message: 'issued-document PDFs are signed with the KMS key', details };
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
