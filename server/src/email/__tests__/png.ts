import { inflateSync } from 'node:zlib';

/**
 * MUT-484: a small PNG reader for the mail-art tests (8-bit RGBA, non-interlaced, as the served art must be). It reads
 * the pixels so look.test.ts can check transparency; it never writes. Anything else is refused, never guessed at.
 */
export interface Rgba {
  width: number;
  height: number;
  /** width × height × 4 bytes, RGBA, row-major. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES_PER_PIXEL = 4;
/** The IHDR facts the mail art must have: 8-bit RGBA (colour type 6), non-interlaced. */
export function pngHeader(file: Uint8Array): { width: number; height: number; bitDepth: number; colourType: number; interlace: number } {
  const buf = Buffer.from(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24]!, colourType: buf[25]!, interlace: buf[28]! };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array): Rgba {
  const head = pngHeader(file);
  if (head.bitDepth !== 8 || head.colourType !== 6 || head.interlace !== 0) {
    throw new Error(`only 8-bit RGBA non-interlaced PNGs are read (got depth ${head.bitDepth}, colour type ${head.colourType}, interlace ${head.interlace})`);
  }
  const buf = Buffer.from(file);
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = head;
  const stride = width * BYTES_PER_PIXEL;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= BYTES_PER_PIXEL ? data[y * stride + x - BYTES_PER_PIXEL]! : 0;
      const up = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= BYTES_PER_PIXEL ? data[(y - 1) * stride + x - BYTES_PER_PIXEL]! : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predictor === undefined) throw new Error(`bad PNG filter ${filter} on row ${y}`);
      data[y * stride + x] = (raw[src + x]! + predictor) & 0xff;
    }
  }
  return { width, height, data };
}
