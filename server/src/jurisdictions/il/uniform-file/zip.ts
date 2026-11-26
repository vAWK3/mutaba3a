import { strToU8, zipSync } from 'fflate';
import type { UniformFile } from './export.js';

/**
 * MUT-569 (D7): the download. `OPENFRMT/<vat>.<YY>/<MMDDhhmm>/INI.TXT` and `…/BKMVDATA.zip` holding `BKMVDATA.TXT`
 * (spec §2.2, §2.5 ד: BKMVDATA is archived in a common format), and `report.html`, the printable production summary and
 * documents report. Small (a 10k-document business is a few MB of text), so it is built in memory.
 */
export const UNIFORM_FILE_MIME = 'application/zip';

export function uniformFileZip(file: UniformFile, reportHtml: string): Uint8Array {
  const bkmvZip = zipSync({ 'BKMVDATA.TXT': new Uint8Array(file.bkmv) });
  return zipSync({
    [`${file.folder}/INI.TXT`]: new Uint8Array(file.ini),
    // Already compressed: stored as is.
    [`${file.folder}/BKMVDATA.zip`]: [bkmvZip, { level: 0 }],
    'report.html': strToU8(reportHtml),
  });
}
