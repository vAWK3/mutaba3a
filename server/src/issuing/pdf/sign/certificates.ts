import { createHash, randomBytes } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { der, signatureAlgorithm, toArrayBuffer } from './cms.js';

/**
 * MUT-641 (ADR-265): X.509 certificates this service issues itself: the development authority's (root, document signer,
 * time-stamp authority) and the interim self-issued certificate for a Cloud KMS key, used in production until a
 * registered certifying authority certifies the same key. The issuer's key signs through a callback, so a KMS key
 * signs its own certificate without leaving KMS.
 */

const EKU_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
const KEY_USAGE = { digitalSignature: 0x80, nonRepudiation: 0x40, keyCertSign: 0x04, cRLSign: 0x02 } as const;

export interface CertificateName {
  commonName: string;
  organization: string;
  /** ISO 3166 two letters; Israel by default. */
  country?: string;
  /** The registration number (Israeli company number, ח.פ.), as certifying authorities ask for it in a request. */
  serialNumber?: string;
}

export interface CertificateRequest {
  subject: CertificateName;
  /** The subject's public key (SubjectPublicKeyInfo, DER). */
  publicKey: Uint8Array;
  /** Who signs it; null = self-issued (the subject's own key signs). */
  issuer: { name: CertificateName; publicKey: Uint8Array } | null;
  kind: 'root' | 'signer' | 'timestamp';
  validFrom: Date;
  validTo: Date;
  /** The issuer key's algorithm: RSA signs PKCS #1 v1.5, EC signs DER ECDSA, both over SHA-256. */
  issuerKeyAlgorithm: 'RSA' | 'EC';
  /** A SHA-256 signature over the to-be-signed bytes, with the issuer's key. */
  sign(tbs: Uint8Array): Promise<Uint8Array>;
}

/** C, O, CN, each its own RDN (pkijs would put them in one multi-valued RDN, which validators print as C=…+O=…+CN=…). */
export function nameOf(name: CertificateName): pkijs.RelativeDistinguishedNames {
  const rdn = (type: string, value: asn1js.BaseStringBlock) => new asn1js.Set({ value: [new pkijs.AttributeTypeAndValue({ type, value }).toSchema()] });
  const sequence = new asn1js.Sequence({
    value: [
      rdn('2.5.4.6', new asn1js.PrintableString({ value: name.country ?? 'IL' })),
      rdn('2.5.4.10', new asn1js.Utf8String({ value: name.organization })),
      ...(name.serialNumber ? [rdn('2.5.4.5', new asn1js.PrintableString({ value: name.serialNumber }))] : []),
      rdn('2.5.4.3', new asn1js.Utf8String({ value: name.commonName })),
    ],
  });
  return pkijs.RelativeDistinguishedNames.fromBER(toArrayBuffer(der(sequence)));
}

/** RFC 5280's method 1: the SHA-1 of the public key's bits. An identifier, not a security property. */
function keyIdentifier(spki: Uint8Array): ArrayBuffer {
  const info = pkijs.PublicKeyInfo.fromBER(toArrayBuffer(spki));
  return toArrayBuffer(new Uint8Array(createHash('sha1').update(new Uint8Array(info.subjectPublicKey.valueBlock.valueHexView)).digest()));
}

/** KeyUsage (critical). DER: a named bit list drops its trailing zero bits. */
function keyUsage(bits: number): pkijs.Extension {
  return extension('2.5.29.15', true, new asn1js.BitString({ valueHex: toArrayBuffer(new Uint8Array([bits])), unusedBits: Math.log2(bits & -bits) }));
}

function extension(extnID: string, critical: boolean, value: { toSchema(): { toBER(sizeOnly?: boolean): ArrayBuffer } } | asn1js.BaseBlock) {
  const schema = 'toSchema' in value ? value.toSchema() : value;
  return new pkijs.Extension({ extnID, critical, extnValue: schema.toBER(false) });
}

/** A DER certificate. */
export async function issueCertificate(request: CertificateRequest): Promise<Uint8Array> {
  const cert = new pkijs.Certificate();
  const serial = new Uint8Array(randomBytes(16));
  serial[0] = (serial[0]! & 0x7f) | 0x40; // positive, no leading zero
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ valueHex: toArrayBuffer(serial) });
  cert.subject = nameOf(request.subject);
  cert.issuer = nameOf(request.issuer?.name ?? request.subject);
  cert.notBefore.value = request.validFrom;
  cert.notAfter.value = request.validTo;
  cert.subjectPublicKeyInfo = pkijs.PublicKeyInfo.fromBER(toArrayBuffer(request.publicKey));
  const usage =
    request.kind === 'root' ? KEY_USAGE.keyCertSign | KEY_USAGE.cRLSign : request.kind === 'signer' ? KEY_USAGE.digitalSignature | KEY_USAGE.nonRepudiation : KEY_USAGE.digitalSignature;
  cert.extensions = [
    extension('2.5.29.19', true, new pkijs.BasicConstraints({ cA: request.kind === 'root' })),
    keyUsage(usage),
    extension('2.5.29.14', false, new asn1js.OctetString({ valueHex: keyIdentifier(request.publicKey) })),
    extension('2.5.29.35', false, new pkijs.AuthorityKeyIdentifier({ keyIdentifier: new asn1js.OctetString({ valueHex: keyIdentifier(request.issuer?.publicKey ?? request.publicKey) }) })),
    ...(request.kind === 'timestamp' ? [extension('2.5.29.37', true, new pkijs.ExtKeyUsage({ keyPurposes: [EKU_TIME_STAMPING] }))] : []),
  ];
  cert.signature = signatureAlgorithm(request.issuerKeyAlgorithm);
  cert.signatureAlgorithm = signatureAlgorithm(request.issuerKeyAlgorithm);
  cert.tbsView = der(cert.encodeTBS());
  const signature = await request.sign(cert.tbsView);
  cert.signatureValue = new asn1js.BitString({ valueHex: toArrayBuffer(signature) });
  return der(cert.toSchema(false));
}

const SIGNER_KEY_USAGE = KEY_USAGE.digitalSignature | KEY_USAGE.nonRepudiation;

export interface CertificateRequestInput {
  subject: CertificateName;
  /** The key's public key (SubjectPublicKeyInfo, DER). */
  publicKey: Uint8Array;
  keyAlgorithm: 'RSA' | 'EC';
  /** A SHA-256 signature over the request, with the key itself (proof that whoever asks holds it). */
  sign(tbs: Uint8Array): Promise<Uint8Array>;
}

/**
 * MUT-641: a PKCS #10 certificate request for a document-signing key, asking for digitalSignature + nonRepudiation.
 * What a certifying authority needs to certify a key it never sees: the KMS key signs its own request.
 */
export async function certificateRequest(input: CertificateRequestInput): Promise<Uint8Array> {
  const request = new pkijs.CertificationRequest();
  request.version = 0;
  request.subject = nameOf(input.subject);
  request.subjectPublicKeyInfo = pkijs.PublicKeyInfo.fromBER(toArrayBuffer(input.publicKey));
  const extensions = new pkijs.Extensions({
    extensions: [keyUsage(SIGNER_KEY_USAGE)],
  });
  request.attributes = [new pkijs.Attribute({ type: '1.2.840.113549.1.9.14', values: [extensions.toSchema()] })];
  request.signatureAlgorithm = signatureAlgorithm(input.keyAlgorithm);
  request.tbsView = der((request as unknown as { encodeTBS(): asn1js.Sequence }).encodeTBS());
  request.signatureValue = new asn1js.BitString({ valueHex: toArrayBuffer(await input.sign(request.tbsView)) });
  return der(request.toSchema(false));
}
