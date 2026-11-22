# MUT-641 — Signed issued-document PDFs (Instruction 18B)

Status: **Built 2026-11-22** (epic MUT-566 lane, Basel's priority run) · Server only · Builds on MUT-640 (ADR-261) and MUT-646 · ADR-265 · API 1.121.0-mut641

## Problem

MUT-640 renders the issued-document PDF; nothing signs it. Under Instruction 18B a tax document sent electronically is the original only when it carries an electronic signature proving who issued it and that it wasn't changed (and the recipient agreed beforehand). An unsigned PDF sent by email is probably not a valid original.

## Acceptance criteria (ticket)

1. A signed PDF verifies as valid and unmodified in Acrobat and an open-source validator, with the timestamp shown.
2. Changing one byte of a signed PDF makes verification fail (test).
3. No signing key material in the image, repo, logs or environment; the service account can sign but not export the key.
4. Every delivery route returns a signed file; the preview is unsigned (contract test per route).
5. A signing outage returns an error instead of an unsigned file (test).
6. The text in the signed file still extracts in reading order (MUT-640's gate on the signed output).
7. The accountant's answers recorded in MUT-566 with a date. (Basel's, not code.)

## Open decision (Basel), not blocking the build

Which production certificate: the accountant answers MUT-567 Q3 (secure e-signature? the software house signs for every business, or each business?), then a registered Israeli certifying authority's organisational signing certificate + TSA. Queued in `~/Work/tools/heavy-gate/DECISIONS.md`. The build assumes "the software house signs" (the ticket's assumption) and leaves a configuration seam; until it's filled, production answers 503 rather than send unsigned.

## Design

`server/src/issuing/pdf/sign/` (pure Node: `pdf-lib` for the signature field, `pkijs`/`asn1js` for CMS; no native code, fits Cloud Run):

| File | Does |
|---|---|
| `cms.ts` | CAdES-detached SignedData: signed attributes content-type, message-digest, signing-certificate-v2 (no signing-time; DER-sorted); verifies the key's signature against its certificate before use (a KMS key paired with the wrong certificate fails here). |
| `pdf.ts` | Invisible signature field on page 1, `/SubFilter /ETSI.CAdES.detached`, 24 KB `/Contents` placeholder, `/ByteRange` over everything else; `/Reason`, `/Name`, `/Location`, `/M`. Saved without object streams so the placeholders stay findable. |
| `timestamp.ts` | `Timestamper`: RFC 3161 over HTTP (checks granted status, our nonce, our digest) or a local development TSA. The token goes in as the signature-time-stamp unsigned attribute (PAdES B-T). |
| `keys.ts` | `SigningKey`: the development authority (root → document signer + TSA, RSA-2048, made in-process on first use, never written anywhere) or Cloud KMS (`asymmetricSign` over the digest through the service account; the certificate chain from configuration). |
| `verify.ts` | `checkSignedPdf`: byte ranges cover the whole file, digest, signature, signing-certificate-v2, content types, time-stamp imprint and its signature. Used by tests and evidence. |
| `index.ts` | `DocumentSigner`, `documentSignerFrom(config)`, `signatureDetailsOf(doc)` (the panel's reason in the document's language: "signed by MTB3A on behalf of <legal name> (<number>)"). |

**Config** (`server/src/config.ts`): `ISSUING_SIGNER` dev | kms | off (unset = dev outside production, off in production; `dev` refused in production), `ISSUING_SIGNING_KMS_KEY` (key version name), `ISSUING_SIGNING_CERT_CHAIN` (PEM, refused if it holds a private key), `ISSUING_TSA_URL` (https), `ISSUING_SIGNING_TIMEOUT_MS` (10 s). `kms` needs all three.

**Routes** (`routes/issuing.ts`): `GET` and `POST /v1/issued-documents/{id}/pdf` return signed files; `POST /v1/issued-documents/preview/pdf` stays unsigned with its draft mark. No signer → 503 `SIGNING_NOT_CONFIGURED` before any copy is recorded (the original isn't spent). Signing failure → 503 `SIGNING_UNAVAILABLE`, logged; the issue stands; a retry with the same Idempotency-Key gets the same copy, now signed.

**Stored original:** `issued_document_originals` (INSERT-only by the MUT-568 trigger, no FKs, purge-exempt, kept with the documents for MUT-644). The first produced copy (copy 0, "מקור") is signed once, kept, and every later request for copy 0 gets those bytes. Later copies ("העתק") are signed afresh each time.

## Interim v1 (Basel, 2026-11-22): signing before a certifying authority does

Basel asked to sign in production while the authority deal is negotiated. The production KMS key certifies itself: `npm run signing:interim-cert -- --key <version> --organization "Barmajiyat Ltd."` (operator ADC with `cloudkms.publicKeyViewer` + `cloudkms.signer` on that key) prints a self-issued certificate signed inside KMS; it becomes `ISSUING_SIGNING_CERT_CHAIN`. Readers show "signature valid, document unchanged, signer not trusted". Later the authority certifies the same key from a CSR (`npm run signing:interim-cert -- --csr --key <version> --organization … --company-number …`, a PKCS #10 request KMS signs; OpenSSL verified one on 2026-11-22), and only the chain changes. Time-stamps from a public RFC 3161 service until then: Sectigo over https (DigiCert, Sectigo, FreeTSA verified against our client on 2026-11-22; production refuses plain http). Legal standing: the accountant's call (MUT-567 Q3).

## Decisions taken in the build

- **S1** PAdES B-T now; B-LT (DSS dictionary with OCSP/CRL) needs the real CA's revocation services → TD-316.
- **S2** Copy 0 is stored signed; copies are not stored (they're signed per request).
- **S3** Production without a configured signer refuses (503), never the dev authority and never unsigned.
- **S4** The customer's consent to receive documents digitally is not built here: the accountant's answer to Q3 decides its shape and retention, and MUT-570/573 own the field and UI → TD-317.
- **S5** `pdf-lib` moves from dev to runtime dependencies; `pkijs` 3.4.3 and `asn1js` 3.1.0 added (both pure JS).

## Tests

- `sign/__tests__/sign.test.ts`: intact signature + time-stamp; one-byte tamper in content, dictionary, CMS wrapper, signature value, end of file; appended bytes; unsigned; key and TSA outages reject; mismatched key; panel language; KMS request shape and missing signature; RFC 3161 client (granted, HTTP error, refusal, wrong nonce, wrong digest); config → signer.
- `__tests__/gate.test.ts`: the MUT-640 gate on signed output for every style × language.
- `__tests__/routes-issuing-pdf.test.ts`: each delivery route signed, preview unsigned; stored original replayed byte-for-byte; no signer → 503 with no copy counted; outage → 503 then the retry is the signed original.
- Store contract (memory + Prisma) for `keepOriginalPdf`/`getOriginalPdf`; Prisma trigger refuses UPDATE/DELETE/TRUNCATE on originals.
- Independent: poppler `pdfsig` ("Signature is Valid", "Total document signed") and `openssl cms -verify` on the generated files.

## QA scenarios

No screen in this ticket (MUT-570/573 show and send the PDF). Evidence is the API: a produced copy verified by `pdfsig` and OpenSSL, the preview not signed, a server without a signer refusing. Release-QA flows come with MUT-570's portal issuing.

## Cost

Dev/QA: nothing. Production (after Basel's decision): the certificate (yearly), Cloud KMS HSM key version (~$1–2.5/month) + signing operations (fractions of a cent each), the CA's TSA (often bundled).

## Pre-landing review (2026-11-22)

/review with 7 specialists, a Red Team and an adversarial pass, then a second adversarial check on the fixes. Fixed: an outage no longer spends the original, and the original goes out on exactly one copy (kept with its copyIndex); certificate validity is checked at signing and the chain at boot (boot log and 30-day warning); the time-stamp token is verified (signature, timeStamping certificate, imprint, nonce, clock within 10 minutes) and its reply capped while streaming; one retry each for KMS and the TSA, never for setup errors (KMS 400/403/404 included); SIGNING_NOT_CONFIGURED carries `details.reason`; a 10-minute view-copy cache; Terraform `prevent_destroy`, an https-only TSA (Sectigo) and a Cloud Run precondition for the chain-needs-key rule. Open: TD-318 (Sentry grouping and the off state's reports), TD-319 (per-instance view cache).

