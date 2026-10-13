import { readFileSync } from 'node:fs';

/** Width and height read from a PNG's IHDR chunk (bytes 16–24), for asset-size contracts in tests. */
export function pngSize(file: string): [number, number] {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
