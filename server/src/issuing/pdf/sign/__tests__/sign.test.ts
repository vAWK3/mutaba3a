import { constants, generateKeyPairSync, privateEncrypt, sign as signBytes, verify as verifyBytes, X509Certificate } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { printPdf } from '../../../../pdf/print.js';
import { buildSignedData, der, OID, sha256, toArrayBuffer, type SigningKey } from '../cms.js';
import { documentSigner, documentSignerFrom, devDocumentSigner, signatureDetailsOf, signerStatus } from '../index.js';
import { devSigningAuthority, interimCertificate, kmsCertificateRequest, kmsSigningKey, type KmsApi } from '../keys.js';
import { issueCertificate } from '../certificates.js';
import { signPdf } from '../pdf.js';
import { localTimestamper, rfc3161Timestamper, type BinaryPost, type Timestamper } from '../timestamp.js';
import { checkSignedPdf } from '../verify.js';

/** MUT-641 (ADR-265): PAdES B-T signatures on issued-document PDFs, with the development authority. */

const DETAILS = { reason: 'נחתם דיגיטלית על ידי MTB3A בשם ברמג׳יאת בע״מ (123456789)', name: 'ברמג׳יאת בע״מ', location: 'Nazareth', signedAt: new Date('2026-11-22T10:00:00Z') };
const pdfOnce = printPdf({ content: [{ text: 'MTB3A signature test' }], defaultStyle: { font: 'PlexLatin' } });
const devTsa = localTimestamper(async () => (await devSigningAuthority()).timestampAuthority);
const signDev = async (pdf: Uint8Array, timestamper: Timestamper = devTsa) => signPdf(pdf, DETAILS, (await devSigningAuthority()).signer, timestamper);
/** A KMS that only signs (the public-key read is the interim certificate's, tested below). */
const kmsApi = (post: KmsApi['post']): KmsApi => ({ get: () => Promise.reject(new Error('not asked')), post });
const toPem = (der: Uint8Array) => `-----BEGIN CERTIFICATE-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;

describe('signing an issued-document PDF (MUT-641)', () => {
  it('signs with a CAdES-detached signature and a time-stamp that verify, over the whole file', async () => {
    const signed = await signDev(await pdfOnce);
    const check = checkSignedPdf(signed);
    expect(check.problems).toEqual([]);
    expect(check.intact).toBe(true);
    expect(check.subFilter).toBe('ETSI.CAdES.detached');
    expect(check.reason).toBe(DETAILS.reason);
    expect(check.signer).toContain('MTB3A development document signing');
    expect(check.timestampAuthority).toContain('MTB3A development time-stamping');
    expect(Math.abs(check.timestampedAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('changing any one byte of the signed file makes it fail (AC2)', async () => {
    const signed = await signDev(await pdfOnce);
    const text = Buffer.from(signed).toString('latin1');
    const contents = text.indexOf('/Contents <');
    // A byte in the (compressed) page content, the signature dictionary, the CMS wrapper, the signature value, the end.
    // The document signer's signature: sha256WithRSAEncryption (with NULL) then OCTET STRING(256), found by structure.
    const signatureValue = text.indexOf('06092A864886F70D01010B050004820100', contents);
    expect(signatureValue).toBeGreaterThan(contents);
    for (const at of [Math.floor(contents / 2), text.indexOf('/Reason') + 3, contents + 40, signatureValue + 60, signed.length - 2]) {
      const tampered = new Uint8Array(signed);
      tampered[at] = tampered[at] === 0x41 ? 0x42 : 0x41;
      expect(checkSignedPdf(tampered).intact, `byte ${at}`).toBe(false);
    }
  });

  it('a byte written into the signature slot\'s zero padding (outside every byte range) is reported', async () => {
    const signed = await signDev(await pdfOnce);
    const text = Buffer.from(signed).toString('latin1');
    const padding = text.indexOf('00000000>', text.indexOf('/Contents <')) + 2;
    const tampered = new Uint8Array(signed);
    tampered[padding] = 0x31;
    expect(checkSignedPdf(tampered).problems).toContain('the signature value has bytes after the signature');
  });

  it('a file with bytes added after signing no longer counts as signed whole', async () => {
    const signed = await signDev(await pdfOnce);
    const appended = new Uint8Array([...signed, ...Buffer.from('\n% appended\n')]);
    expect(checkSignedPdf(appended).problems).toContain('the signature does not cover the whole file');
  });

  it('an unsigned file is reported as not signed', async () => {
    expect(checkSignedPdf(await pdfOnce)).toMatchObject({ intact: false, problems: ['not signed'] });
  });

  it('a key or time-stamp outage rejects: nothing unsigned comes back (AC5)', async () => {
    const authority = await devSigningAuthority();
    const down: SigningKey = { chain: authority.signer.chain, sign: () => Promise.reject(new Error('KMS unavailable')) };
    await expect(signPdf(await pdfOnce, DETAILS, down, devTsa)).rejects.toThrow('KMS unavailable');
    await expect(signDev(await pdfOnce, { timestamp: () => Promise.reject(new Error('TSA unavailable')) })).rejects.toThrow('TSA unavailable');
  });

  it('a key that does not match its certificate is refused, as a setup problem', async () => {
    const authority = await devSigningAuthority();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const mismatched: SigningKey = { chain: authority.signer.chain, sign: async (data) => new Uint8Array(signBytes('sha256', data, other.privateKey)) };
    await expect(signPdf(await pdfOnce, DETAILS, mismatched, devTsa)).rejects.toMatchObject({ name: 'SigningSetupError', reason: 'KEY_MISMATCH' });
  });

  it('a certificate outside its validity signs nothing (an original is kept for good)', async () => {
    const authority = await devSigningAuthority();
    const notAfter = new Date(new X509Certificate(authority.signer.chain[0]!).validTo);
    const late = { ...DETAILS, signedAt: new Date(notAfter.getTime() + 60_000) };
    await expect(signPdf(await pdfOnce, late, authority.signer, devTsa)).rejects.toMatchObject({ name: 'SigningSetupError', reason: 'CERTIFICATE_NOT_VALID' });
    const early = { ...DETAILS, signedAt: new Date('2000-01-01T00:00:00Z') };
    await expect(signPdf(await pdfOnce, early, authority.signer, devTsa)).rejects.toMatchObject({ reason: 'CERTIFICATE_NOT_VALID' });
  });

  it('the signature panel speaks the document language and names the business', () => {
    const doc = { language: 'ar', issuer: { legalName: 'شركة برمجيات م.ض.', vatId: '123456789', city: 'الناصرة' } } as never;
    expect(signatureDetailsOf(doc, DETAILS.signedAt)).toEqual({ reason: 'وُقّع رقميًا من MTB3A نيابةً عن شركة برمجيات م.ض. (123456789)', name: 'شركة برمجيات م.ض.', location: 'الناصرة', signedAt: DETAILS.signedAt });
  });
});

describe('Cloud KMS key (MUT-641)', () => {
  /** KMS stands in as a key this test holds, certified under the development root: it signs the digest it is sent. */
  const kms = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const DIGEST_INFO_SHA256 = Buffer.from('3031300d060960864801650304020105000420', 'hex');
  const kmsSignsDigest = (digest: Buffer) => privateEncrypt({ key: kms.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([DIGEST_INFO_SHA256, digest]));
  const KEY = 'projects/p/locations/europe-west1/keyRings/issuing/cryptoKeys/documents/cryptoKeyVersions/1';

  it('sends KMS the SHA-256 digest only, and signs with what KMS answers', async () => {
    const chainPem = (await (await devSigningAuthority()).certify(kms.publicKey)).map(toPem).join('');
    const calls: Array<{ url: string; body: unknown }> = [];
    const key = kmsSigningKey({
      keyVersion: KEY,
      chainPem,
      timeoutMs: 1000,
      kms: kmsApi(async (url, body) => {
        calls.push({ url, body });
        const digest = Buffer.from((body as { digest: { sha256: string } }).digest.sha256, 'base64');
        return { signature: kmsSignsDigest(digest).toString('base64') };
      }),
    });
    const signed = await signPdf(await pdfOnce, DETAILS, key, devTsa);
    expect(checkSignedPdf(signed).problems).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://cloudkms.googleapis.com/v1/${KEY}:asymmetricSign`);
    expect(Object.keys(calls[0]!.body as object)).toEqual(['digest']);
  });

  it('a KMS answer without a signature fails the signing', async () => {
    const chainPem = (await (await devSigningAuthority()).certify(kms.publicKey)).map(toPem).join('');
    const key = kmsSigningKey({ keyVersion: KEY, chainPem, timeoutMs: 1000, kms: kmsApi(async () => ({})) });
    await expect(signPdf(await pdfOnce, DETAILS, key, devTsa)).rejects.toThrow('without a signature');
  });

  it('a KMS hiccup gets one more try; two in a row fail the signing', async () => {
    const chainPem = (await (await devSigningAuthority()).certify(kms.publicKey)).map(toPem).join('');
    let calls = 0;
    const flaky = kmsSigningKey({
      keyVersion: KEY,
      chainPem,
      timeoutMs: 1000,
      kms: kmsApi(async (_url, body) => {
        calls += 1;
        if (calls === 1) throw new Error('503 from KMS');
        return { signature: kmsSignsDigest(Buffer.from((body as { digest: { sha256: string } }).digest.sha256, 'base64')).toString('base64') };
      }),
    });
    expect(checkSignedPdf(await signPdf(await pdfOnce, DETAILS, flaky, devTsa)).intact).toBe(true);
    expect(calls).toBe(2);
    const down = kmsSigningKey({ keyVersion: KEY, chainPem, timeoutMs: 1000, kms: kmsApi(async () => Promise.reject(new Error('KMS down'))) });
    await expect(signPdf(await pdfOnce, DETAILS, down, devTsa)).rejects.toThrow('KMS down');
  });

  it('KMS refusing (403, a disabled key version) is a setup problem, not retried', async () => {
    const chainPem = (await (await devSigningAuthority()).certify(kms.publicKey)).map(toPem).join('');
    let calls = 0;
    const refused = kmsSigningKey({ keyVersion: KEY, chainPem, timeoutMs: 1000, kms: kmsApi(async () => ((calls += 1), Promise.reject(Object.assign(new Error('Permission denied'), { response: { status: 403 } })))) });
    await expect(signPdf(await pdfOnce, DETAILS, refused, devTsa)).rejects.toMatchObject({ name: 'SigningSetupError', reason: 'KEY_UNAVAILABLE' });
    expect(calls).toBe(1);
  });

  it('a chain in the wrong order (the CA first, or an issuer that didn\'t issue it) is refused at once', async () => {
    const [leaf, root] = await (await devSigningAuthority()).certify(kms.publicKey);
    expect(() => kmsSigningKey({ keyVersion: KEY, chainPem: toPem(root!) + toPem(leaf!), timeoutMs: 1000, kms: kmsApi(async () => ({})) })).toThrow('starts with a CA certificate');
    const stranger = (await (await devSigningAuthority()).certify(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey))[0]!;
    expect(() => kmsSigningKey({ keyVersion: KEY, chainPem: toPem(leaf!) + toPem(stranger), timeoutMs: 1000, kms: kmsApi(async () => ({})) })).toThrow("didn't issue");
    expect(() => kmsSigningKey({ keyVersion: KEY, chainPem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n', timeoutMs: 1000, kms: kmsApi(async () => ({})) })).toThrow("can't be read");
  });

  it('a chain with no certificate is refused at once', () => {
    expect(() => kmsSigningKey({ keyVersion: KEY, chainPem: 'not a certificate', timeoutMs: 1000, kms: kmsApi(async () => ({})) })).toThrow('holds no certificate');
  });
});

describe('RFC 3161 time-stamp authority client (MUT-641)', () => {
  /** A TSA in this test: it answers a request the way a real one does, with our nonce or (to test refusals) without. */
  function tsa(behaviour: { status?: number; pkiStatus?: number; nonce?: 'echo' | 'other'; digest?: 'echo' | 'other'; signer?: 'not-a-tsa' | 'forged'; genTime?: Date; failFirst?: boolean }): BinaryPost {
    let calls = 0;
    return async (_url, body, contentType) => {
      expect(contentType).toBe('application/timestamp-query');
      calls += 1;
      if (behaviour.failFirst && calls === 1) return { status: 502, contentType: 'text/plain', body: new Uint8Array() };
      if (behaviour.status && behaviour.status !== 200) return { status: behaviour.status, contentType: 'text/plain', body: new Uint8Array() };
      const request = pkijs.TimeStampReq.fromBER(toArrayBuffer(body));
      const digest = new Uint8Array(request.messageImprint.hashedMessage.valueBlock.valueHexView);
      const status = new pkijs.PKIStatusInfo({ status: behaviour.pkiStatus ?? 0 });
      if ((behaviour.pkiStatus ?? 0) > 1) return { status: 200, contentType: 'application/timestamp-reply', body: der(new pkijs.TimeStampResp({ status }).toSchema()) };
      const tst = der(
        new pkijs.TSTInfo({
          version: 1,
          policy: '1.3.6.1.4.1.32473.641.1',
          messageImprint: new pkijs.MessageImprint({
            hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
            hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(behaviour.digest === 'other' ? sha256(digest) : digest) }),
          }),
          serialNumber: new asn1js.Integer({ value: 7 }),
          genTime: behaviour.genTime ?? new Date(),
          ...(request.nonce ? { nonce: behaviour.nonce === 'other' ? new asn1js.Integer({ value: 1 }) : request.nonce } : {}),
        }).toSchema(),
      );
      const authority = await devSigningAuthority();
      // not-a-tsa: a real signature by a certificate made for documents, not time-stamping; forged: a broken signature.
      const key = behaviour.signer === 'not-a-tsa' ? authority.signer : authority.timestampAuthority;
      let token = await buildSignedData({ key, contentType: OID.tstInfo, contentDigest: sha256(tst), content: tst });
      if (behaviour.signer === 'forged') {
        const hex = Buffer.from(token).toString('hex');
        const at = hex.lastIndexOf('04820100') + 8 + 40; // inside the TSA's RSA signature value
        token = new Uint8Array(Buffer.from(hex.slice(0, at) + (hex[at] === 'a' ? 'b' : 'a') + hex.slice(at + 1), 'hex'));
      }
      const response = new pkijs.TimeStampResp({ status, timeStampToken: pkijs.ContentInfo.fromBER(toArrayBuffer(token)) });
      return { status: 200, contentType: 'application/timestamp-reply', body: der(response.toSchema()) };
    };
  }

  it('a granted token with our nonce and digest goes into the signature', async () => {
    const signed = await signDev(await pdfOnce, rfc3161Timestamper('https://tsa.example/', { timeoutMs: 1000, post: tsa({}) }));
    expect(checkSignedPdf(signed).problems).toEqual([]);
  });

  it.each([
    ['an HTTP error', { status: 503 }, 'answered 503'],
    ['a refusal', { pkiStatus: 2 }, 'refused'],
    ['another nonce', { nonce: 'other' as const }, 'another request'],
    ['another digest', { digest: 'other' as const }, 'another digest'],
    // MUT-641 review: an http answer is only as good as its signature.
    ['a broken token signature', { signer: 'forged' as const }, 'the signature does not verify'],
    ['a token from a certificate not made for time-stamping', { signer: 'not-a-tsa' as const }, 'not a time-stamp authority'],
    ['a time far from ours', { genTime: new Date(Date.now() - 60 * 60 * 1000) }, 'too far from ours'],
  ])('%s fails the signing', async (_name, behaviour, message) => {
    await expect(signDev(await pdfOnce, rfc3161Timestamper('https://tsa.example/', { timeoutMs: 1000, post: tsa(behaviour) }))).rejects.toThrow(message);
  });

  it('an oversized reply is refused while it streams, chunked or not (no length up front)', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/timestamp-reply' }); // no content-length: chunked
      const chunk = Buffer.alloc(64 * 1024);
      for (let i = 0; i < 8; i += 1) res.write(chunk);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(rfc3161Timestamper(`http://127.0.0.1:${port}/`, { timeoutMs: 5000 }).timestamp(new Uint8Array(32))).rejects.toThrow('too large');
    } finally {
      server.close();
    }
  });

  it('a transient failure (a 502) gets one more try, and the second answer is used', async () => {
    const signed = await signDev(await pdfOnce, rfc3161Timestamper('https://tsa.example/', { timeoutMs: 1000, post: tsa({ failFirst: true }) }));
    expect(checkSignedPdf(signed).intact).toBe(true);
  });
});

describe('which signer a server has (MUT-641)', () => {
  const base = { ISSUING_SIGNING_TIMEOUT_MS: 5000 };
  it('production has none until it is configured; elsewhere the development authority signs', () => {
    expect(documentSignerFrom({ ...base, NODE_ENV: 'production' })).toBeNull();
    expect(documentSignerFrom({ ...base, NODE_ENV: 'development' })?.kind).toBe('dev');
    expect(documentSignerFrom({ ...base, NODE_ENV: 'test' })?.kind).toBe('dev');
    expect(documentSignerFrom({ ...base, NODE_ENV: 'staging', ISSUING_SIGNER: 'off' })).toBeNull();
  });

  it('kms signs through KMS and time-stamps through the configured authority', async () => {
    const authority = await devSigningAuthority();
    const signer = documentSignerFrom(
      { ...base, NODE_ENV: 'production', ISSUING_SIGNER: 'kms', ISSUING_SIGNING_KMS_KEY: 'k', ISSUING_SIGNING_CERT_CHAIN: authority.signer.chain.map(toPem).join(''), ISSUING_TSA_URL: 'https://tsa.example/' },
      { kms: kmsApi(async () => ({ signature: 'AA==' })), tsaPost: async () => ({ status: 500, contentType: null, body: new Uint8Array() }) },
    );
    expect(signer?.kind).toBe('kms');
    // The stand-in KMS answers a signature that isn't the certificate's: refused before any time-stamp is asked for.
    await expect(signer!.sign(await pdfOnce, DETAILS)).rejects.toThrow('does not match its certificate');
  });

  it('the boot log says who signs until when, and warns as the certificate\'s end nears or passes', async () => {
    const cert = new X509Certificate((await devSigningAuthority()).signer.chain[0]!);
    const signer = { kind: 'kms' as const, certificate: cert, sign: async (pdf: Uint8Array) => pdf };
    const end = new Date(cert.validTo).getTime();
    expect(signerStatus(signer, new Date(end - 90 * 86_400_000))).toMatchObject({ level: 'info', details: { daysLeft: 90 } });
    expect(signerStatus(signer, new Date(end - 10 * 86_400_000)).level).toBe('warn');
    expect(signerStatus(signer, new Date(end + 86_400_000)).level).toBe('error');
    expect(signerStatus({ kind: 'dev', sign: async (pdf: Uint8Array) => pdf }, new Date()).level).toBe('info');
  });

  it('documentSigner wraps any key and time-stamp authority', async () => {
    const authority = await devSigningAuthority();
    const signed = await documentSigner('dev', async () => authority.signer, devTsa).sign(await pdfOnce, DETAILS);
    expect(checkSignedPdf(signed).intact).toBe(true);
    expect(checkSignedPdf(await devDocumentSigner().sign(await pdfOnce, DETAILS)).intact).toBe(true);
  });
});

describe('the interim self-issued certificate for a KMS key (MUT-641, ADR-265)', () => {
  /** KMS stands in as keys this test holds: it answers the public key and signs digests, like the real API. */
  // RSA only: Node can't ECDSA-sign a precomputed digest, which is all KMS receives (the EC path is tested below).
  function fakeKms(algorithm: string) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const DIGEST_INFO_SHA256 = Buffer.from('3031300d060960864801650304020105000420', 'hex');
    const calls: string[] = [];
    const api: KmsApi = {
      get: async (url) => {
        calls.push(`GET ${url}`);
        return { pem: pair.publicKey.export({ type: 'spki', format: 'pem' }), algorithm };
      },
      post: async (url, body) => {
        calls.push(`POST ${url}`);
        const digest = Buffer.from((body as { digest: { sha256: string } }).digest.sha256, 'base64');
        const signature = privateEncrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([DIGEST_INFO_SHA256, digest]));
        return { signature: signature.toString('base64') };
      },
    };
    return { api, calls };
  }
  const KEY = 'projects/p/locations/europe-west1/keyRings/issuing/cryptoKeys/documents/cryptoKeyVersions/1';
  const validity = { validFrom: new Date('2026-11-22T00:00:00Z'), validTo: new Date('2028-11-22T00:00:00Z') };

  it('KMS certifies its own key in the business name, and that certificate signs PDFs', async () => {
    const { api, calls } = fakeKms('RSA_SIGN_PKCS1_2048_SHA256');
    const interim = await interimCertificate({ keyVersion: KEY, organization: 'Barmajiyat Ltd.', ...validity, kms: api });
    expect(calls).toEqual([`GET https://cloudkms.googleapis.com/v1/${KEY}/publicKey`, `POST https://cloudkms.googleapis.com/v1/${KEY}:asymmetricSign`]);
    const x509 = new X509Certificate(interim.pem);
    expect(x509.subject).toBe('C=IL\nO=Barmajiyat Ltd.\nCN=Barmajiyat Ltd. document signing (self-issued)');
    expect(x509.issuer).toBe(x509.subject);
    expect(x509.ca).toBe(false);
    expect(x509.validTo).toContain('2028');
    expect(interim.fingerprint).toBe(x509.fingerprint256);
    const signed = await signPdf(await pdfOnce, DETAILS, kmsSigningKey({ keyVersion: KEY, chainPem: interim.pem, timeoutMs: 1000, kms: api }), devTsa);
    const check = checkSignedPdf(signed);
    expect(check.problems).toEqual([]);
    expect(check.signer).toContain('Barmajiyat Ltd. document signing (self-issued)');
  });

  it('an EC P-256 key (EC_SIGN_P256_SHA256) self-issues its certificate and signs PDFs', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spki = new Uint8Array(ec.publicKey.export({ type: 'spki', format: 'der' }));
    const sign = async (data: Uint8Array) => new Uint8Array(signBytes('sha256', data, { key: ec.privateKey, dsaEncoding: 'der' }));
    const name = { commonName: 'Barmajiyat Ltd. document signing (self-issued)', organization: 'Barmajiyat Ltd.' };
    const cert = await issueCertificate({ subject: name, publicKey: spki, issuer: null, kind: 'signer', ...validity, issuerKeyAlgorithm: 'EC', sign });
    expect(new X509Certificate(cert).verify(ec.publicKey)).toBe(true);
    const signed = await signPdf(await pdfOnce, DETAILS, { chain: [cert], sign }, devTsa);
    expect(checkSignedPdf(signed).problems).toEqual([]);
  });

  it('the certificate request (CSR) for the authority: the KMS key signs it, in the business name with its company number', async () => {
    const { api, calls } = fakeKms('RSA_SIGN_PKCS1_2048_SHA256');
    const request = await kmsCertificateRequest({ keyVersion: KEY, organization: 'Barmajiyat Ltd.', companyNumber: '515123456', kms: api });
    expect(calls).toEqual([`GET https://cloudkms.googleapis.com/v1/${KEY}/publicKey`, `POST https://cloudkms.googleapis.com/v1/${KEY}:asymmetricSign`]);
    expect(request.pem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----\n[\s\S]+\n-----END CERTIFICATE REQUEST-----\n$/);
    const der = Buffer.from(request.pem.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64');
    const csr = pkijs.CertificationRequest.fromBER(toArrayBuffer(new Uint8Array(der)));
    const subject = Object.fromEntries(csr.subject.typesAndValues.map((t) => [t.type, t.value.valueBlock.value]));
    expect(subject).toEqual({ '2.5.4.6': 'IL', '2.5.4.10': 'Barmajiyat Ltd.', '2.5.4.5': '515123456', '2.5.4.3': 'Barmajiyat Ltd.' });
    const publicKey = new X509Certificate(await interimCertificate({ keyVersion: KEY, organization: 'x', validFrom: new Date(), validTo: new Date(Date.now() + 1e9), kms: api }).then((c) => c.pem)).publicKey;
    expect(verifyBytes('sha256', csr.tbsView, publicKey, new Uint8Array(csr.signatureValue.valueBlock.valueHexView))).toBe(true);
    expect(csr.attributes?.[0]?.type).toBe('1.2.840.113549.1.9.14');
  });

  it('refuses a key algorithm the signer does not speak, and a KMS that signs with another key', async () => {
    await expect(interimCertificate({ keyVersion: KEY, organization: 'Barmajiyat Ltd.', ...validity, kms: fakeKms('RSA_SIGN_PSS_2048_SHA256').api })).rejects.toThrow('RSA_SIGN_PSS_2048_SHA256');
    const honest = fakeKms('RSA_SIGN_PKCS1_2048_SHA256');
    const other = fakeKms('RSA_SIGN_PKCS1_2048_SHA256');
    await expect(interimCertificate({ keyVersion: KEY, organization: 'Barmajiyat Ltd.', ...validity, kms: { get: honest.api.get, post: other.api.post } })).rejects.toThrow('another key');
  });
});

