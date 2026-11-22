import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { googleKms, interimCertificate } from '../issuing/pdf/sign/keys.js';

/**
 * MUT-641 (ADR-265): the interim certificate for the production signing key, until a registered certifying authority
 * certifies the same key. Run by an operator with Application Default Credentials that may read the key's public key
 * and sign with it (roles/cloudkms.publicKeyViewer + roles/cloudkms.signer on that key only). Prints the PEM, which is
 * public: it goes into ISSUING_SIGNING_CERT_CHAIN. No key material is read, written or printed.
 *
 *   npm run signing:interim-cert -- --key projects/…/cryptoKeyVersions/1 --organization "Barmajiyat Ltd." [--years 2] [--out interim.pem]
 */
const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    organization: { type: 'string' },
    years: { type: 'string', default: '2' },
    out: { type: 'string' },
  },
});

const years = Number(values.years);
if (!values.key || !/\/cryptoKeyVersions\/\d+$/.test(values.key) || !values.organization?.trim() || !Number.isInteger(years) || years < 1 || years > 5) {
  process.stderr.write('Usage: npm run signing:interim-cert -- --key projects/…/cryptoKeyVersions/N --organization "<legal name>" [--years 1-5] [--out file.pem]\n');
  process.exit(2);
}

const validFrom = new Date();
const validTo = new Date(validFrom);
validTo.setUTCFullYear(validTo.getUTCFullYear() + years);
const interim = await interimCertificate({ keyVersion: values.key, organization: values.organization.trim(), validFrom, validTo, kms: googleKms(15_000) });
if (values.out) writeFileSync(values.out, interim.pem);
else process.stdout.write(interim.pem);
process.stderr.write(
  `Self-issued certificate for ${values.key} (${interim.algorithm}), valid to ${validTo.toISOString().slice(0, 10)}\nSHA-256 fingerprint ${interim.fingerprint}\nSet ISSUING_SIGNING_CERT_CHAIN to it; readers will show the signer as not trusted until a certifying authority certifies this key.\n`,
);
