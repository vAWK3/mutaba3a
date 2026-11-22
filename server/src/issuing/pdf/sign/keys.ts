import { createPublicKey, generateKeyPair, sign as signBytes, X509Certificate, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';
import { GoogleAuth } from 'google-auth-library';
import { issueCertificate, toPem } from './certificates.js';
import { pemCertificates, sha256, type SigningKey } from './cms.js';

/**
 * MUT-641 (ADR-265): where the signing key lives. Two kinds:
 * - development: a throwaway authority made in this process on first use (a root, a document signer under it and a
 *   time-stamp authority under it). Nothing is written anywhere; every restart makes new keys. Refused in production.
 * - Cloud KMS: the key stays in KMS (an HSM-protected key in production); the service account may only sign with it
 *   (roles/cloudkms.signer), never export it. The certificate chain the certifying authority issued for it is public
 *   and comes from configuration.
 */

const generate = promisify(generateKeyPair);

export interface DevAuthority {
  /** The development root, for a validator to trust while checking evidence. Never trusted outside development. */
  root: Uint8Array;
  signer: SigningKey;
  timestampAuthority: SigningKey;
}

const DEV_ORGANIZATION = 'MTB3A development (not for production)';
const spkiOf = (key: KeyObject) => new Uint8Array(key.export({ type: 'spki', format: 'der' }));

function localKey(privateKey: KeyObject, chain: Uint8Array[]): SigningKey {
  return { chain, sign: async (data) => new Uint8Array(signBytes('sha256', data, privateKey)) };
}

interface DevAuthorityWithRoot extends DevAuthority {
  /** Issues a document-signing certificate under the development root for another key (tests stand KMS in with it). */
  certify(publicKey: KeyObject): Promise<Uint8Array[]>;
}

async function makeDevAuthority(): Promise<DevAuthorityWithRoot> {
  const rsa = () => generate('rsa', { modulusLength: 2048 });
  const [root, signer, tsa] = await Promise.all([rsa(), rsa(), rsa()]);
  const validFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const validTo = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const rootName = { commonName: 'MTB3A development root', organization: DEV_ORGANIZATION };
  const signWithRoot = async (tbs: Uint8Array) => new Uint8Array(signBytes('sha256', tbs, root.privateKey));
  const rootCert = await issueCertificate({ subject: rootName, publicKey: spkiOf(root.publicKey), issuer: null, kind: 'root', validFrom, validTo, issuerKeyAlgorithm: 'RSA', sign: signWithRoot });
  const issuer = { name: rootName, publicKey: spkiOf(root.publicKey) };
  const certify = async (publicKey: KeyObject, kind: 'signer' | 'timestamp' = 'signer') => [
    await issueCertificate({
      subject: { commonName: kind === 'signer' ? 'MTB3A development document signing' : 'MTB3A development time-stamping', organization: DEV_ORGANIZATION },
      publicKey: spkiOf(publicKey),
      issuer,
      kind,
      validFrom,
      validTo,
      issuerKeyAlgorithm: 'RSA',
      sign: signWithRoot,
    }),
    rootCert,
  ];
  return {
    root: rootCert,
    signer: localKey(signer.privateKey, await certify(signer.publicKey)),
    timestampAuthority: localKey(tsa.privateKey, await certify(tsa.publicKey, 'timestamp')),
    certify: (publicKey) => certify(publicKey),
  };
}

let devAuthority: Promise<DevAuthorityWithRoot> | null = null;

/** The development authority, made once per process on first use (three RSA keys: well under a second). */
export function devSigningAuthority(): Promise<DevAuthorityWithRoot> {
  devAuthority ??= makeDevAuthority().catch((error: unknown) => {
    devAuthority = null;
    throw error;
  });
  return devAuthority;
}

/** Cloud KMS over REST as the service's own account (Cloud Run's metadata server, or ADC on an operator's machine). */
export interface KmsApi {
  get(url: string): Promise<unknown>;
  post(url: string, body: Record<string, unknown>): Promise<unknown>;
}

const KMS = 'https://cloudkms.googleapis.com/v1';

export function googleKms(timeoutMs: number): KmsApi {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloudkms'] });
  const request = async (url: string, method: 'GET' | 'POST', data?: Record<string, unknown>) => {
    const client = await auth.getClient();
    return (await client.request({ url, method, ...(data ? { data } : {}), timeout: timeoutMs })).data;
  };
  return { get: (url) => request(url, 'GET'), post: (url, body) => request(url, 'POST', body) };
}

/** KMS signs the SHA-256 of `data` (only the digest leaves this process). */
async function kmsSign(kms: KmsApi, keyVersion: string, data: Uint8Array): Promise<Uint8Array> {
  const answer = await kms.post(`${KMS}/${keyVersion}:asymmetricSign`, { digest: { sha256: Buffer.from(sha256(data)).toString('base64') } });
  const signature = (answer as { signature?: unknown } | null)?.signature;
  if (typeof signature !== 'string' || signature.length === 0) throw new Error('Cloud KMS answered without a signature');
  return new Uint8Array(Buffer.from(signature, 'base64'));
}

/** The algorithms this signer speaks: PKCS #1 v1.5 or P-256, both over SHA-256 (what cms.ts declares). */
const KMS_ALGORITHMS: Readonly<Record<string, 'RSA' | 'EC'>> = {
  RSA_SIGN_PKCS1_2048_SHA256: 'RSA',
  RSA_SIGN_PKCS1_3072_SHA256: 'RSA',
  RSA_SIGN_PKCS1_4096_SHA256: 'RSA',
  EC_SIGN_P256_SHA256: 'EC',
};

export interface KmsSigningKeyOptions {
  /** projects/…/locations/…/keyRings/…/cryptoKeys/…/cryptoKeyVersions/N */
  keyVersion: string;
  /** The certificate for the KMS key (a certifying authority's, or the interim self-issued one), then its issuers (PEM). */
  chainPem: string;
  timeoutMs: number;
  /** Tests hand in their own; the service uses its own account. */
  kms?: KmsApi;
}

/** A Cloud KMS asymmetric key (RSA_SIGN_PKCS1_*_SHA256 or EC_SIGN_P256_SHA256): KMS signs the digest; no key leaves it. */
export function kmsSigningKey(options: KmsSigningKeyOptions): SigningKey {
  const chain = pemCertificates(options.chainPem);
  if (chain.length === 0) throw new Error('The signing certificate chain holds no certificate');
  const kms = options.kms ?? googleKms(options.timeoutMs);
  return { chain, sign: (data) => kmsSign(kms, options.keyVersion, data) };
}

export interface InterimCertificateOptions {
  keyVersion: string;
  /** The business that signs: Barmajiyat's legal name, as the certifying authority will certify it later. */
  organization: string;
  validFrom: Date;
  validTo: Date;
  kms: KmsApi;
}

/**
 * MUT-641 (ADR-265, Basel 2026-11-22): the interim certificate. Until a registered certifying authority certifies the
 * KMS key, the key certifies itself: a self-issued document-signing certificate in the business's name, signed inside
 * KMS. Readers verify the signature and that nothing changed, but show the signer as not trusted. When the authority's
 * certificate arrives (from a CSR of the same key), only ISSUING_SIGNING_CERT_CHAIN changes.
 */
export async function interimCertificate(options: InterimCertificateOptions): Promise<{ pem: string; fingerprint: string; algorithm: string }> {
  const key = (await options.kms.get(`${KMS}/${options.keyVersion}/publicKey`)) as { pem?: unknown; algorithm?: unknown } | null;
  if (typeof key?.pem !== 'string' || typeof key.algorithm !== 'string') throw new Error('Cloud KMS answered without the public key');
  const keyAlgorithm = KMS_ALGORITHMS[key.algorithm];
  if (!keyAlgorithm) throw new Error(`The key's algorithm ${key.algorithm} isn't one this signer uses (${Object.keys(KMS_ALGORITHMS).join(', ')})`);
  const publicKey = createPublicKey(key.pem);
  const certificate = await issueCertificate({
    subject: { commonName: `${options.organization} document signing (self-issued)`, organization: options.organization },
    publicKey: new Uint8Array(publicKey.export({ type: 'spki', format: 'der' })),
    issuer: null,
    kind: 'signer',
    validFrom: options.validFrom,
    validTo: options.validTo,
    issuerKeyAlgorithm: keyAlgorithm,
    sign: (tbs) => kmsSign(options.kms, options.keyVersion, tbs),
  });
  const x509 = new X509Certificate(certificate);
  if (!x509.verify(publicKey)) throw new Error('Cloud KMS signed the certificate with another key');
  return { pem: toPem(certificate), fingerprint: x509.fingerprint256, algorithm: key.algorithm };
}
