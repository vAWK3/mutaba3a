import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { googleKms, interimCertificate, kmsCertificateRequest } from '../issuing/pdf/sign/keys.js';

/**
 * MUT-641 (ADR-265): certificates for the production signing key in Cloud KMS. Run by an operator with Application
 * Default Credentials that may read the key's public key and sign with it (roles/cloudkms.publicKeyViewer +
 * roles/cloudkms.signer on that key only). No key material is read, written or printed; the output is public.
 *
 * Interim certificate (self-issued, until a certifying authority certifies the key), for ISSUING_SIGNING_CERT_CHAIN:
 *   npm run signing:interim-cert -- --key projects/…/cryptoKeyVersions/1 --organization "Narabnd Studio Ltd" [--years 2] [--out interim.pem]
 * Certificate request (CSR) for the certifying authority, for the same key:
 *   npm run signing:interim-cert -- --csr --key projects/…/cryptoKeyVersions/1 --organization "Narabnd Studio Ltd" [--company-number 51…] [--common-name "…"] [--out request.csr]
 */
const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    organization: { type: 'string' },
    years: { type: 'string', default: '2' },
    out: { type: 'string' },
    csr: { type: 'boolean', default: false },
    'company-number': { type: 'string' },
    'common-name': { type: 'string' },
  },
});

const USAGE = `Usage:
  npm run signing:interim-cert -- --key projects/…/cryptoKeyVersions/N --organization "<legal name>" [--years 1-5] [--out file.pem]
  npm run signing:interim-cert -- --csr --key projects/…/cryptoKeyVersions/N --organization "<legal name>" [--company-number <ח.פ.>] [--common-name "<name>"] [--out file.csr]
`;
const years = Number(values.years);
const organization = values.organization?.trim();
const companyNumber = values['company-number']?.trim();
if (
  !values.key ||
  !/\/cryptoKeyVersions\/\d+$/.test(values.key) ||
  !organization ||
  (!values.csr && (!Number.isInteger(years) || years < 1 || years > 5)) ||
  (companyNumber !== undefined && !/^\d{9}$/.test(companyNumber))
) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const kms = googleKms(15_000);
const write = (pem: string) => (values.out ? writeFileSync(values.out, pem) : process.stdout.write(pem));

if (values.csr) {
  const request = await kmsCertificateRequest({
    keyVersion: values.key,
    organization,
    kms,
    ...(values['common-name']?.trim() ? { commonName: values['common-name'].trim() } : {}),
    ...(companyNumber ? { companyNumber } : {}),
  });
  write(request.pem);
  process.stderr.write(
    `Certificate request for ${values.key} (${request.algorithm}), signed by the key in KMS.\nSend it to the certifying authority; put the certificate they return (then their chain) in ISSUING_SIGNING_CERT_CHAIN.\n`,
  );
} else {
  const validFrom = new Date();
  const validTo = new Date(validFrom);
  validTo.setUTCFullYear(validTo.getUTCFullYear() + years);
  const interim = await interimCertificate({ keyVersion: values.key, organization, validFrom, validTo, kms });
  write(interim.pem);
  process.stderr.write(
    `Self-issued certificate for ${values.key} (${interim.algorithm}), valid to ${validTo.toISOString().slice(0, 10)}\nSHA-256 fingerprint ${interim.fingerprint}\nSet ISSUING_SIGNING_CERT_CHAIN to it; readers will show the signer as not trusted until a certifying authority certifies this key.\n`,
  );
}
