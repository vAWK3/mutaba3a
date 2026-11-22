import { createHash, X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { OID, sha256, toArrayBuffer, verifyWith } from './cms.js';

/**
 * MUT-641 (ADR-265): checks a signed PDF the way a validator's integrity step does: the byte ranges cover the whole
 * file but the signature, their digest is the signed one, the signature is the certificate's, and the time-stamp
 * token is over this signature and signed by its authority. Trust in the certificates is the validator's own (Acrobat,
 * EU DSS); this answers "is it intact and whose is it". Used by the tests and the evidence script.
 */
export interface SignatureCheck {
  intact: boolean;
  problems: string[];
  signer: string | null;
  /** The time-stamp authority's time, or null without a token. */
  timestampedAt: Date | null;
  timestampAuthority: string | null;
  subFilter: string | null;
  reason: string | null;
}

interface SignerCheck {
  problems: string[];
  certificate: Uint8Array | null;
  signature: Uint8Array;
  signerInfo: pkijs.SignerInfo;
}

const bytesOf = (view: { valueBlock: { valueHexView: Uint8Array } }) => new Uint8Array(view.valueBlock.valueHexView);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

function attribute(attrs: pkijs.SignedAndUnsignedAttributes | undefined, type: string): asn1js.AsnType | undefined {
  return attrs?.attributes.find((a) => a.type === type)?.values[0];
}

/** Digests a signer may use: ours is always SHA-256; a time-stamp authority may sign its token with SHA-384 or -512. */
const DIGESTS: Readonly<Record<string, 'sha256' | 'sha384' | 'sha512'>> = {
  [OID.sha256]: 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};
const SIGNING_CERTIFICATE_V1 = '1.2.840.113549.1.9.16.2.12';

/** The certificate hash an ESS signing-certificate attribute names (v1: SHA-1; v2: its own algorithm, SHA-256 by default). */
function essCertificateHash(attrs: pkijs.SignedAndUnsignedAttributes, certificate: Uint8Array): boolean {
  const v2 = attribute(attrs, OID.signingCertificateV2) as asn1js.Sequence | undefined;
  const v1 = attribute(attrs, SIGNING_CERTIFICATE_V1) as asn1js.Sequence | undefined;
  const essCertId = ((v2 ?? v1)?.valueBlock.value[0] as asn1js.Sequence | undefined)?.valueBlock.value[0] as asn1js.Sequence | undefined;
  if (!essCertId) return false;
  const parts = essCertId.valueBlock.value;
  const named = parts[0] instanceof asn1js.Sequence ? (parts[0].valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString() : null;
  const hash = parts.find((p): p is asn1js.OctetString => p instanceof asn1js.OctetString);
  if (!hash) return false;
  const algorithm = v2 ? (named ? DIGESTS[named] : 'sha256') : 'sha1';
  return Boolean(algorithm) && same(bytesOf(hash), new Uint8Array(createHash(algorithm!).update(certificate).digest()));
}

/** One SignedData's only signer: the content it signed, its signature, its certificate hash. */
function checkSigner(signed: pkijs.SignedData, content: Uint8Array, options: { sha256Only: boolean }): SignerCheck {
  const problems: string[] = [];
  const signerInfo = signed.signerInfos[0];
  if (!signerInfo || !signerInfo.signedAttrs) throw new Error('No signer');
  const digest = DIGESTS[signerInfo.digestAlgorithm.algorithmId];
  if (!digest || (options.sha256Only && digest !== 'sha256')) problems.push('the digest is not SHA-256');
  const hash = digest ?? 'sha256';
  const contentType = attribute(signerInfo.signedAttrs, OID.contentType);
  if (!(contentType instanceof asn1js.ObjectIdentifier) || contentType.valueBlock.toString() !== signed.encapContentInfo.eContentType) problems.push('the signed content type is not the content');
  const signature = bytesOf(signerInfo.signature);
  const messageDigest = attribute(signerInfo.signedAttrs, OID.messageDigest) as asn1js.OctetString | undefined;
  if (!messageDigest || !same(bytesOf(messageDigest), new Uint8Array(createHash(hash).update(content).digest()))) problems.push('the content does not match the signed digest');

  const sid = signerInfo.sid as pkijs.IssuerAndSerialNumber;
  const certificates = (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  const leaf = certificates.find((c) => c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber));
  const certificate = leaf ? new Uint8Array(leaf.toSchema(false).toBER(false)) : null;
  if (!certificate) {
    problems.push('the signer certificate is missing');
    return { problems, certificate, signature, signerInfo };
  }
  if (!verifyWith(certificate, new Uint8Array(signerInfo.signedAttrs.encodedValue), signature, hash)) problems.push('the signature does not verify');
  if (!essCertificateHash(signerInfo.signedAttrs, certificate)) problems.push('the signing-certificate attribute does not name the signer');
  return { problems, certificate, signature, signerInfo };
}

function subjectOf(certificate: Uint8Array | null): string | null {
  return certificate ? new X509Certificate(certificate).subject : null;
}

const EKU_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';

export interface TimestampCheck {
  problems: string[];
  genTime: Date | null;
  authority: string | null;
}

/**
 * MUT-641 (review): an RFC 3161 time-stamp token over a signature (`signatureDigest` is its SHA-256): a SignedData holding a TSTInfo, its SHA-256 imprint
 * of this signature value, signed by a certificate made for time-stamping. The client runs it on every token before
 * embedding it (an http TSA's answer is only as good as its signature), and checkSignedPdf runs it on signed files.
 */
export function checkTimestampToken(token: asn1js.AsnType, signatureDigest: Uint8Array): TimestampCheck {
  const result: TimestampCheck = { problems: [], genTime: null, authority: null };
  try {
    const info = new pkijs.ContentInfo({ schema: token });
    if (info.contentType !== OID.signedData) throw new Error('not a SignedData');
    const signed = new pkijs.SignedData({ schema: info.content });
    if (signed.encapContentInfo.eContentType !== OID.tstInfo) result.problems.push('the token holds no TSTInfo');
    const tstBytes = signed.encapContentInfo.eContent?.getValue();
    if (!tstBytes) throw new Error('no TSTInfo');
    const tst = pkijs.TSTInfo.fromBER(tstBytes);
    const authority = checkSigner(signed, new Uint8Array(tstBytes), { sha256Only: false });
    result.problems.push(...authority.problems);
    if (authority.certificate && !(new X509Certificate(authority.certificate).keyUsage ?? []).includes(EKU_TIME_STAMPING)) result.problems.push('the signer is not a time-stamp authority');
    if (tst.messageImprint.hashAlgorithm.algorithmId !== OID.sha256) result.problems.push('the imprint is not SHA-256');
    if (!same(bytesOf(tst.messageImprint.hashedMessage), signatureDigest)) result.problems.push('the time-stamp is for another signature');
    result.genTime = tst.genTime;
    result.authority = subjectOf(authority.certificate);
  } catch (error) {
    result.problems.push(`the token can't be read (${error instanceof Error ? error.message : String(error)})`);
  }
  return result;
}

const pdfString = (text: string, key: string): string | null => {
  const m = new RegExp(`/${key}\\s*(<[0-9A-Fa-f]*>|\\/[^\\s/<>\\[\\]]+)`).exec(text);
  if (!m) return null;
  if (m[1]!.startsWith('/')) return m[1]!.slice(1);
  const bytes = Buffer.from(m[1]!.slice(1, -1), 'hex');
  return bytes[0] === 0xfe && bytes[1] === 0xff ? bytes.subarray(2).swap16().toString('utf16le') : bytes.toString('latin1');
};

export function checkSignedPdf(pdf: Uint8Array): SignatureCheck {
  const result: SignatureCheck = { intact: false, problems: [], signer: null, timestampedAt: null, timestampAuthority: null, subFilter: null, reason: null };
  const text = Buffer.from(pdf).toString('latin1');
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const range = ranges.at(-1);
  if (!range) return { ...result, problems: ['not signed'] };
  const [a, b, c, d] = range.slice(1, 5).map(Number) as [number, number, number, number];
  if (a !== 0 || c + d !== pdf.length) result.problems.push('the signature does not cover the whole file');
  const contents = text.slice(b, c);
  if (!/^<[0-9A-Fa-f]+>$/.test(contents)) return { ...result, problems: [...result.problems, 'the signature value is not where the byte ranges say'] };
  const dict = text.slice(text.lastIndexOf('<<', range.index), text.indexOf('>>', c) + 2);
  result.subFilter = pdfString(dict, 'SubFilter');
  result.reason = pdfString(dict, 'Reason');

  try {
    const cms = new Uint8Array(Buffer.from(contents.slice(1, -1), 'hex'));
    const end = asn1js.fromBER(toArrayBuffer(cms)).offset;
    // The placeholder's padding isn't covered by the byte ranges (no PDF signature covers it); it must stay zeros.
    if (cms.subarray(end).some((byte) => byte !== 0)) result.problems.push('the signature value has bytes after the signature');
    const info = pkijs.ContentInfo.fromBER(toArrayBuffer(cms.subarray(0, end)));
    if (info.contentType !== OID.signedData) throw new Error('not a SignedData');
    const signed = new pkijs.SignedData({ schema: info.content });
    if (signed.encapContentInfo.eContentType !== OID.data || signed.encapContentInfo.eContent) result.problems.push('the signature is not a detached signature over the file');
    const covered = Buffer.concat([Buffer.from(pdf.subarray(a, a + b)), Buffer.from(pdf.subarray(c, c + d))]);
    const document = checkSigner(signed, covered, { sha256Only: true });
    result.problems.push(...document.problems);
    result.signer = subjectOf(document.certificate);

    const token = attribute(document.signerInfo.unsignedAttrs, OID.signatureTimeStampToken);
    if (!token) result.problems.push('no time-stamp');
    else {
      const stamp = checkTimestampToken(token, sha256(document.signature));
      result.problems.push(...stamp.problems.map((p) => (p === 'the time-stamp is for another signature' ? p : `time-stamp: ${p}`)));
      result.timestampedAt = stamp.genTime;
      result.timestampAuthority = stamp.authority;
    }
  } catch (error) {
    result.problems.push(`the signature can't be read (${error instanceof Error ? error.message : String(error)})`);
  }
  result.intact = result.problems.length === 0;
  return result;
}
