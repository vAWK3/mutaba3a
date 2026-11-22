import { createHash, verify as verifySignature, X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

/**
 * MUT-641 (ADR-265): CMS signatures in the shape PAdES baseline asks for (ETSI EN 319 142-1, CAdES detached): a
 * content-type, a message digest and the signer's certificate hash as signed attributes, no signing-time (the PDF's
 * /M carries it), SHA-256. The same builder signs a document and, in the development time-stamp authority, a TSTInfo.
 */

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimeStampToken: '1.2.840.113549.1.9.16.2.14',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
} as const;

/**
 * A key that signs and never leaves where it is kept: a development key in this process, a Cloud KMS key in
 * production. `sign` returns a SHA-256 signature over `data` (PKCS #1 v1.5 for RSA, DER-encoded ECDSA for EC).
 */
export interface SigningKey {
  /** DER certificates: the signer's own first, then the certificates that issued it. */
  readonly chain: readonly Uint8Array[];
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export const sha256 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(bytes).digest());

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export function parseCertificate(der: Uint8Array): pkijs.Certificate {
  return pkijs.Certificate.fromBER(toArrayBuffer(der));
}

/** The signature algorithm a certificate's key signs with: RSA or EC, always over SHA-256. */
function signatureAlgorithmOf(cert: pkijs.Certificate): pkijs.AlgorithmIdentifier {
  const keyAlgorithm = cert.subjectPublicKeyInfo.algorithm.algorithmId;
  if (keyAlgorithm === OID.rsaEncryption) return new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRsa, algorithmParams: new asn1js.Null() });
  if (keyAlgorithm === OID.ecPublicKey) return new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaWithSha256 });
  throw new Error(`Unsupported signing key algorithm ${keyAlgorithm}`);
}

/** SigningCertificateV2 (RFC 5035): the signer certificate's SHA-256 (the default hash, so not named) and issuer/serial. */
function signingCertificateV2(cert: pkijs.Certificate, certDer: Uint8Array): asn1js.Sequence {
  const issuerSerial = new asn1js.Sequence({
    value: [new asn1js.Sequence({ value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })] }), cert.serialNumber],
  });
  const essCertIdV2 = new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: toArrayBuffer(sha256(certDer)) }), issuerSerial] });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });
}

export const der = (schema: { toBER(sizeOnly?: boolean): ArrayBuffer }): Uint8Array => new Uint8Array(schema.toBER(false));

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

export interface SignedDataInput {
  key: SigningKey;
  /** What is signed: `data` (a PDF's byte ranges, detached) or a TSTInfo (encapsulated). */
  contentType: string;
  /** The SHA-256 of the signed content. */
  contentDigest: Uint8Array;
  /** Encapsulated content (a TSTInfo); absent for a detached signature. */
  content?: Uint8Array;
  /** A time-stamp authority's token over the signature value, added as an unsigned attribute. */
  timestamp?: (signatureDigest: Uint8Array) => Promise<Uint8Array>;
}

/** A ContentInfo holding one SignedData with one signer, DER-encoded. */
export async function buildSignedData(input: SignedDataInput): Promise<Uint8Array> {
  const [leafDer] = input.key.chain;
  if (!leafDer) throw new Error('A signing key needs its certificate');
  const leaf = parseCertificate(leafDer);
  const attributes = [
    new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: input.contentType })] }),
    new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: toArrayBuffer(input.contentDigest) })] }),
    new pkijs.Attribute({ type: OID.signingCertificateV2, values: [signingCertificateV2(leaf, leafDer)] }),
  ].sort((a, b) => compareBytes(der(a.toSchema()), der(b.toSchema()))); // DER: a SET OF is sorted by encoding
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes });
  const toBeSigned = der(signedAttrs.toSchema());
  toBeSigned[0] = 0x31; // signed over as a SET, carried as [0] IMPLICIT

  const signature = await input.key.sign(toBeSigned);
  // A key that answers with another key's signature (a KMS key paired with the wrong certificate) stops here.
  if (!verifyWith(leafDer, toBeSigned, signature)) throw new Error('The signing key does not match its certificate');

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
    signedAttrs,
    signatureAlgorithm: signatureAlgorithmOf(leaf),
    signature: new asn1js.OctetString({ valueHex: toArrayBuffer(signature) }),
  });
  if (input.timestamp) {
    const token = await input.timestamp(sha256(signature));
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [new pkijs.Attribute({ type: OID.signatureTimeStampToken, values: [asn1js.fromBER(toArrayBuffer(token)).result] })],
    });
  }
  const signedData = new pkijs.SignedData({
    version: input.content ? 3 : 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: input.contentType,
      ...(input.content ? { eContent: new asn1js.OctetString({ valueHex: toArrayBuffer(input.content) }) } : {}),
    }),
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
    certificates: input.key.chain.map(parseCertificate),
    signerInfos: [signerInfo],
  });
  return der(new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) }).toSchema());
}

/** Whether `signature` is the certificate's key's signature over `data` (SHA-256 unless named). */
export function verifyWith(certDer: Uint8Array, data: Uint8Array, signature: Uint8Array, hash: 'sha256' | 'sha384' | 'sha512' = 'sha256'): boolean {
  try {
    return verifySignature(hash, data, new X509Certificate(certDer).publicKey, signature);
  } catch {
    return false;
  }
}

/** PEM certificates (a chain, signer first) to DER. */
export function pemCertificates(pem: string): Uint8Array[] {
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)].map((m) => new Uint8Array(Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64')));
}
