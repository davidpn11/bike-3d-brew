// Random access into a zip held as a Blob (usually the dropped File, which the browser keeps on
// disk). Only the central directory and the requested entries are read, so a 500 MB capture
// bundle full of HEIC photos never has to sit in memory to show a handful of close-ups.

import { inflateSync } from 'fflate';

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate; anything else is unsupported. */
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the local file header. */
  offset: number;
}

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

async function read(blob: Blob, start: number, end: number): Promise<DataView> {
  if (start < 0 || end > blob.size || start > end) throw new ZipError('Zip structure points outside the file.');
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** Lists a zip's entries by name (directories included) from its central directory. */
export async function readZipIndex(blob: Blob): Promise<Map<string, ZipEntry>> {
  const tailStart = Math.max(0, blob.size - (22 + MAX_COMMENT));
  const tail = await read(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a zip: end of central directory not found.');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // Zip64 (big exports): the real values live in a separate record found via a locator.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== SIG_EOCD64_LOCATOR) throw new ZipError('Zip64 locator missing.');
    const at = u64(tail, loc + 8);
    const rec = await read(blob, at, at + 56);
    if (rec.getUint32(0, true) !== SIG_EOCD64) throw new ZipError('Zip64 record missing.');
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }

  const cd = await read(blob, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('Corrupt central directory.');
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // Zip64 extra field: 64-bit values appear only for the fields that overflowed, in this order.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = u64(cd, q)), (q += 8);
        if (compressedSize === 0xffffffff) (compressedSize = u64(cd, q)), (q += 8);
        if (offset === 0xffffffff) offset = u64(cd, q);
      }
      e += 4 + len;
    }
    entries.set(name, { name, method, compressedSize, size, offset });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** Decompresses one entry, refusing anything that would inflate past `maxBytes`. */
export async function readZipEntry(blob: Blob, entry: ZipEntry, maxBytes = 64 << 20): Promise<Uint8Array> {
  if (entry.size > maxBytes) throw new ZipError(`${entry.name} is too large (${Math.round(entry.size / 2 ** 20)} MB).`);
  const head = await read(blob, entry.offset, entry.offset + 30);
  if (head.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`Corrupt local header for ${entry.name}.`);
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = new Uint8Array(await blob.slice(start, start + entry.compressedSize).arrayBuffer());
  if (raw.length !== entry.compressedSize) throw new ZipError(`${entry.name} is truncated.`);
  let out: Uint8Array;
  if (entry.method === 0) out = raw;
  else if (entry.method === 8) out = inflateSync(raw, { out: new Uint8Array(entry.size) });
  else throw new ZipError(`${entry.name} uses unsupported compression (method ${entry.method}).`);
  if (out.length !== entry.size) throw new ZipError(`${entry.name} did not decompress cleanly.`);
  return out;
}
