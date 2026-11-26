import { randomBytes } from 'node:crypto';
import { ApiError } from '../../../errors.js';
import type { JurisdictionPack } from '../../pack.js';
import { buildUniformFile, DocumentTooLargeError, UNIFORM_FILE_HOUSE_PLACEHOLDER } from './export.js';
import { uniformFileReport } from './report.js';
import { UNIFORM_FILE_MIME, uniformFileZip } from './zip.js';

/** MUT-569: the product's name in the uniform file (A000 1007). Moved here by MUT-741 with the rest of the file's rules. */
const SOFTWARE_NAME = 'MTB3A';

/**
 * A000 1004: 15 random digits, one per export, the first never zero (appendix 5, note 2). From randomBytes, which the
 * signed-out portal's crypto shim also has (no randomInt there).
 */
const ID_FLOOR = 10n ** 14n;
const primaryId = () => String(ID_FLOOR + (BigInt(`0x${randomBytes(8).toString('hex')}`) % (9n * ID_FLOOR)));

/** MUT-569/MUT-644, moved from routes/issuing.ts by MUT-741: the uniform file's zip for these documents. */
export const IL_STATUTORY_FILE: NonNullable<JurisdictionPack['statutoryFile']> = {
  mime: UNIFORM_FILE_MIME,
  housePlaceholder: UNIFORM_FILE_HOUSE_PLACEHOLDER,
  zipOf({ house, coreVersion, issuer, documents, originals, range, now, lang }) {
    const software = { ...house, name: SOFTWARE_NAME, version: coreVersion };
    let file;
    try {
      file = buildUniformFile({ issuer, documents, originals, range, producedAt: now, primaryId: primaryId(), software });
    } catch (err) {
      if (!(err instanceof DocumentTooLargeError)) throw err;
      throw new ApiError('VALIDATION_FAILED', `${err.docType} ${err.number} has an amount too large for the uniform file`, { reason: 'UNIFORM_FILE_AMOUNT_TOO_LARGE', docType: err.docType, number: err.number });
    }
    const report = uniformFileReport(file, { businessName: issuer.legalName, vatId: issuer.vatId, range, producedAt: now, software }, lang);
    return { file, zip: uniformFileZip(file, report) };
  },
};
