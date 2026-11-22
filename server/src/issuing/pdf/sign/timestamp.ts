import { randomBytes } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { buildSignedData, der, OID, sha256, toArrayBuffer, type SigningKey } from './cms.js';

/**
 * MUT-641 (ADR-265): the trusted time on a signature (PAdES B-T). An RFC 3161 time-stamp authority signs the hash of
 * the signature value; its token rides in the signature as an unsigned attribute, so a validator shows when the
 * document was signed, from a clock the business doesn't control.
 */
export interface Timestamper {
  /** A TimeStampToken (a CMS ContentInfo, DER) over the SHA-256 `digest`. */
  timestamp(digest: Uint8Array): Promise<Uint8Array>;
}

const imprintOf = (digest: Uint8Array) =>
  new pkijs.MessageImprint({ hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }), hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(digest) }) });

function positiveInteger(bytes: number): asn1js.Integer {
  const value = new Uint8Array(randomBytes(bytes));
  value[0] = (value[0]! & 0x7f) | 0x40;
  return new asn1js.Integer({ valueHex: toArrayBuffer(value) });
}

/** Development and tests: a time-stamp authority in this process, signing with the development TSA key. */
export function localTimestamper(authority: () => Promise<SigningKey>, now: () => Date = () => new Date()): Timestamper {
  return {
    async timestamp(digest) {
      const tstInfo = der(
        new pkijs.TSTInfo({
          version: 1,
          policy: '1.3.6.1.4.1.32473.641.1', // an example-arc policy: development time only
          messageImprint: imprintOf(digest),
          serialNumber: positiveInteger(16),
          genTime: now(),
        }).toSchema(),
      );
      return buildSignedData({ key: await authority(), contentType: OID.tstInfo, contentDigest: sha256(tstInfo), content: tstInfo });
    },
  };
}

export type BinaryPost = (url: string, body: Uint8Array, contentType: string) => Promise<{ status: number; contentType: string | null; body: Uint8Array }>;

const fetchPost =
  (timeoutMs: number): BinaryPost =>
  async (url, body, contentType) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body: Buffer.from(body), signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, contentType: response.headers.get('content-type'), body: new Uint8Array(await response.arrayBuffer()) };
  };

/**
 * Production: an RFC 3161 authority over HTTP (the certifying authority's own TSA). The answer must be granted and
 * carry our nonce and our digest, or the signature fails rather than carry a time that isn't ours.
 */
export function rfc3161Timestamper(url: string, options: { timeoutMs: number; post?: BinaryPost }): Timestamper {
  const post = options.post ?? fetchPost(options.timeoutMs);
  return {
    async timestamp(digest) {
      const nonce = positiveInteger(8);
      const request = new pkijs.TimeStampReq({ version: 1, messageImprint: imprintOf(digest), nonce, certReq: true });
      const answer = await post(url, der(request.toSchema()), 'application/timestamp-query');
      if (answer.status !== 200) throw new Error(`The time-stamp authority answered ${answer.status}`);
      const response = pkijs.TimeStampResp.fromBER(toArrayBuffer(answer.body));
      const granted = response.status.status === 0 || response.status.status === 1;
      if (!granted || !response.timeStampToken) throw new Error(`The time-stamp authority refused (status ${response.status.status})`);
      const signed = new pkijs.SignedData({ schema: response.timeStampToken.content });
      const content = signed.encapContentInfo.eContent?.getValue();
      if (!content) throw new Error('The time-stamp token holds no TSTInfo');
      const tst = pkijs.TSTInfo.fromBER(content);
      const imprint = new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView);
      if (Buffer.compare(Buffer.from(imprint), Buffer.from(digest)) !== 0) throw new Error('The time-stamp token is for another digest');
      if (!tst.nonce || !tst.nonce.isEqual(nonce)) throw new Error('The time-stamp token is for another request');
      return der(response.timeStampToken.toSchema());
    },
  };
}
