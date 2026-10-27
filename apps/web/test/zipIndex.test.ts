import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipError, readZipEntry, readZipIndex } from '../src/scene/zipIndex';

// Hand-built zips, so the branches fflate never writes (zip64 records and extras, foreign extra
// fields, odd methods, lying sizes) are exercised byte by byte.

interface Spec {
  name: string;
  data: Uint8Array;
  method?: number;
  /** Bytes actually written for the entry (defaults to deflated / stored data). */
  payload?: Uint8Array;
  /** Override the sizes recorded in the central directory. */
  size?: number;
}

interface Options {
  zip64Eocd?: boolean;
  zip64Extras?: boolean;
  foreignExtra?: boolean;
  breakLocator?: boolean;
  breakZip64Record?: boolean;
  /** Claim more entries than the central directory holds. */
  extraCount?: number;
}

const enc = new TextEncoder();

function buildZip(specs: Spec[], o: Options = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (b: Uint8Array) => (chunks.push(b), (offset += b.length));
  const central: Uint8Array[] = [];
  for (const s of specs) {
    const method = s.method ?? 8;
    const payload = s.payload ?? (method === 8 ? deflateSync(s.data) : s.data);
    const name = enc.encode(s.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, method, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, s.data.length, true);
    local.setUint16(26, name.length, true);
    const at = offset;
    push(new Uint8Array(local.buffer));
    push(name);
    push(payload);

    const extras: Uint8Array[] = [];
    if (o.foreignExtra) {
      const x = new DataView(new ArrayBuffer(8));
      x.setUint16(0, 0x5455, true); // extended timestamp: must be skipped
      x.setUint16(2, 4, true);
      extras.push(new Uint8Array(x.buffer));
    }
    if (o.zip64Extras) {
      const x = new DataView(new ArrayBuffer(4 + 24));
      x.setUint16(0, 0x0001, true);
      x.setUint16(2, 24, true);
      x.setBigUint64(4, BigInt(s.size ?? s.data.length), true);
      x.setBigUint64(12, BigInt(payload.length), true);
      x.setBigUint64(20, BigInt(at), true);
      extras.push(new Uint8Array(x.buffer));
    }
    const extraLen = extras.reduce((n, e) => n + e.length, 0);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, method, true);
    c.setUint32(20, o.zip64Extras ? 0xffffffff : payload.length, true);
    c.setUint32(24, o.zip64Extras ? 0xffffffff : (s.size ?? s.data.length), true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, extraLen, true);
    c.setUint16(32, 2, true); // a 2-byte comment, skipped
    c.setUint32(42, o.zip64Extras ? 0xffffffff : at, true);
    central.push(new Uint8Array(c.buffer), name, ...extras, enc.encode('hi'));
  }
  const cdOffset = offset;
  for (const b of central) push(b);
  const cdSize = offset - cdOffset;
  const count = specs.length + (o.extraCount ?? 0);

  if (o.zip64Eocd) {
    const recAt = offset;
    const rec = new DataView(new ArrayBuffer(56));
    rec.setUint32(0, o.breakZip64Record ? 0xdeadbeef : 0x06064b50, true);
    rec.setBigUint64(4, 44n, true);
    rec.setBigUint64(24, BigInt(count), true);
    rec.setBigUint64(32, BigInt(count), true);
    rec.setBigUint64(40, BigInt(cdSize), true);
    rec.setBigUint64(48, BigInt(cdOffset), true);
    push(new Uint8Array(rec.buffer));
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, o.breakLocator ? 0 : 0x07064b50, true);
    loc.setBigUint64(8, BigInt(recAt), true);
    loc.setUint32(16, 1, true);
    push(new Uint8Array(loc.buffer));
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, o.zip64Eocd ? 0xffff : count, true);
  eocd.setUint16(10, o.zip64Eocd ? 0xffff : count, true);
  eocd.setUint32(12, o.zip64Eocd ? 0xffffffff : cdSize, true);
  eocd.setUint32(16, o.zip64Eocd ? 0xffffffff : cdOffset, true);
  push(new Uint8Array(eocd.buffer));

  const out = new Uint8Array(offset);
  let p = 0;
  for (const b of chunks) out.set(b, p), (p += b.length);
  return out;
}

const blob = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);
const photo = new Uint8Array(4000).map((_, i) => (i * 13) % 256);
const files: Spec[] = [
  { name: 'cap/manifest.json', data: enc.encode('{"schema":"bike-capture/1"}') },
  { name: 'cap/images/IMG_0001.HEIC', data: photo, method: 0 },
];

async function roundTrip(o: Options) {
  const b = blob(buildZip(files, o));
  const index = await readZipIndex(b);
  expect([...index.keys()]).toEqual(files.map((f) => f.name));
  for (const f of files) expect(await readZipEntry(b, index.get(f.name)!)).toEqual(f.data);
  return index;
}

describe('readZipIndex', () => {
  it('reads a plain hand-built zip, skipping comments and foreign extra fields', async () => {
    const index = await roundTrip({ foreignExtra: true });
    expect(index.get('cap/images/IMG_0001.HEIC')).toMatchObject({ method: 0, size: 4000, compressedSize: 4000 });
  });

  it('follows the zip64 locator to the real central directory', async () => {
    await roundTrip({ zip64Eocd: true });
  });

  it('reads 64-bit sizes and offsets from zip64 extra fields', async () => {
    const index = await roundTrip({ zip64Extras: true, foreignExtra: true });
    expect(index.get('cap/images/IMG_0001.HEIC')!.offset).toBeGreaterThan(0);
  });

  it('handles zip64 records and extras together', async () => {
    await roundTrip({ zip64Eocd: true, zip64Extras: true });
  });

  it('rejects a missing zip64 locator or record', async () => {
    await expect(readZipIndex(blob(buildZip(files, { zip64Eocd: true, breakLocator: true })))).rejects.toThrow(/Zip64 locator missing/);
    await expect(readZipIndex(blob(buildZip(files, { zip64Eocd: true, breakZip64Record: true })))).rejects.toThrow(/Zip64 record missing/);
    // An EOCD claiming zip64 with nothing in front of it at all.
    const bare = buildZip([], { zip64Eocd: true }).slice(-22);
    await expect(readZipIndex(blob(bare))).rejects.toThrow(/Zip64 locator missing/);
  });

  it('rejects a central directory with fewer entries than claimed', async () => {
    await expect(readZipIndex(blob(buildZip(files, { extraCount: 1 })))).rejects.toThrow(ZipError);
    await expect(readZipIndex(blob(buildZip(files, { extraCount: 1 })))).rejects.toThrow(/Corrupt central directory/);
  });
});

describe('readZipEntry', () => {
  it('refuses unsupported compression methods', async () => {
    const b = blob(buildZip([{ name: 'x.bin', data: photo, method: 12, payload: photo }]));
    const entry = (await readZipIndex(b)).get('x.bin')!;
    await expect(readZipEntry(b, entry)).rejects.toThrow(/unsupported compression \(method 12\)/);
  });

  it('notices truncated data and sizes that do not match', async () => {
    const b = blob(buildZip([{ name: 'x.bin', data: photo, method: 0, size: 3000 }]));
    const entry = (await readZipIndex(b)).get('x.bin')!;
    await expect(readZipEntry(b, entry)).rejects.toThrow(/did not decompress cleanly/);
    await expect(readZipEntry(b, { ...entry, compressedSize: 1 << 20 })).rejects.toThrow(/truncated/);
  });
});
