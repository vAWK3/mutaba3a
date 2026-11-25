import { randomBytes } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { buildSignedData, der, OID, sha256, toArrayBuffer, type SigningKey } from './cms.js';
import { withOneRetry } from './retry.js';
import { checkTimestampToken } from './verify.js';

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

/** A time-stamp reply is a few KB; anything far larger is not one, and isn't read into memory. */
export const MAX_TSA_REPLY_BYTES = 256 * 1024;
/** How far the authority's clock may be from ours: past it, the time isn't one we can stand behind. */
export const MAX_TSA_CLOCK_SKEW_MS = 10 * 60 * 1000;

const fetchPost =
  (timeoutMs: number): BinaryPost =>
  async (url, body, contentType) => {
    const controller = new AbortController();
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body: Buffer.from(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]) });
    // Read as it arrives and stop past the cap, chunked or not: a reply that size isn't a time-stamp.
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > MAX_TSA_REPLY_BYTES) {
        controller.abort();
        throw new Error('The time-stamp reply is too large');
      }
      chunks.push(chunk);
    }
    return { status: response.status, contentType: response.headers.get('content-type'), body: new Uint8Array(Buffer.concat(chunks)) };
  };

/**
 * Production: an RFC 3161 authority over HTTP: the certifying authority's own, or a public one (Sectigo over https by default)
 * until then. The answer must be granted, carry our nonce and our digest, verify as a time-stamp authority's
 * signature and keep to our clock, or the signature fails rather than carry a time that isn't ours (an http answer is
 * only as good as its signature). A transient failure (a timeout, a 5xx) gets one more try.
 */
export function rfc3161Timestamper(url: string, options: { timeoutMs: number; post?: BinaryPost; now?: () => Date }): Timestamper {
  const post = options.post ?? fetchPost(options.timeoutMs);
  const now = options.now ?? (() => new Date());
  return { timestamp: (digest) => withOneRetry(() => requestToken(url, post, digest, now)) };
}

async function requestToken(url: string, post: BinaryPost, digest: Uint8Array, now: () => Date): Promise<Uint8Array> {
  const nonce = positiveInteger(8);
  const request = new pkijs.TimeStampReq({ version: 1, messageImprint: imprintOf(digest), nonce, certReq: true });
  const answer = await post(url, der(request.toSchema()), 'application/timestamp-query');
  if (answer.status !== 200) throw new Error(`The time-stamp authority answered ${answer.status}`);
  const response = pkijs.TimeStampResp.fromBER(toArrayBuffer(answer.body));
  const granted = response.status.status === 0 || response.status.status === 1;
  if (!granted || !response.timeStampToken) throw new Error(`The time-stamp authority refused (status ${response.status.status})`);
  const token = response.timeStampToken.toSchema();
  const check = checkTimestampToken(token, digest);
  if (check.problems.includes('the time-stamp is for another signature')) throw new Error('The time-stamp token is for another digest');
  if (check.problems.length > 0) throw new Error(`The time-stamp token doesn't verify: ${check.problems.join('; ')}`);
  const tstBytes = new pkijs.SignedData({ schema: response.timeStampToken.content }).encapContentInfo.eContent!.getValue();
  const tst = pkijs.TSTInfo.fromBER(tstBytes);
  if (!tst.nonce || !tst.nonce.isEqual(nonce)) throw new Error('The time-stamp token is for another request');
  if (Math.abs(tst.genTime.getTime() - now().getTime()) > MAX_TSA_CLOCK_SKEW_MS) throw new Error('The time-stamp authority\'s time is too far from ours');
  return der(token);
}
