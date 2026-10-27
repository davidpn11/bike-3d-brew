// Binary USD (crate) reading on top of three.js's USDCParser, with the value encodings it misses.
// No three.js objects are created here, so this also runs inside the parse worker.

import { type CrateValueRep, USDCParser, type UsdLayerData } from 'three/examples/jsm/loaders/usd/USDCParser.js';

// crateDataTypes.h
const T = { Int: 3, Int64: 5, UInt64: 6, Half: 7, Matrix2d: 13, Matrix3d: 14, Quath: 18, Vec2d: 19, Vec3d: 23, Vec3h: 25, Vec4d: 27, Vec4h: 29, Vec4i: 30 } as const;

/** Vector types that USD inlines as one signed int8 per component when every component is a small integer. */
const INT8_VECTORS: Record<number, number> = { [T.Vec2d]: 2, [T.Vec3d]: 3, [T.Vec4d]: 4, [T.Vec3h]: 3, [T.Vec4h]: 4 };

export const CRATE_MAGIC = 'PXR-USDC';

export function isCrate(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== CRATE_MAGIC.charCodeAt(i)) return false;
  return true;
}

export class CrateParser extends USDCParser {
  protected override _readInlinedValue(rep: CrateValueRep): unknown {
    const type = rep.typeEnum;
    const payload = rep.getInlinedValue();
    const n = INT8_VECTORS[type];
    if (n) {
      // three r186 returns the raw packed int here, so e.g. `double3 xformOp:translate = (0, 0, 5)` or an
      // integral `xformOp:rotateXYZ` turned into a number and broke the transform.
      const view = this._conversionView;
      view.setUint32(0, payload, true);
      return Array.from({ length: n }, (_, i) => view.getInt8(i));
    }
    switch (type) {
      case T.Int:
      case T.Int64:
        return payload | 0; // payload is the unsigned low word
      case T.UInt64:
        return payload >>> 0;
      case T.Half:
        return this._halfToFloat(payload & 0xffff);
    }
    return super._readInlinedValue(rep);
  }

  protected override _readScalarValue(type: number): unknown {
    const r = this.reader;
    const halves = (n: number) => Array.from({ length: n }, () => this._readHalf());
    switch (type) {
      case T.Vec3h:
        return halves(3);
      case T.Vec4h:
      case T.Quath:
        return halves(4);
      case T.Vec4i:
        return [r.readInt32(), r.readInt32(), r.readInt32(), r.readInt32()];
      case T.Matrix2d:
        return Array.from({ length: 4 }, () => r.readFloat64());
      case T.Matrix3d:
        return Array.from({ length: 9 }, () => r.readFloat64());
    }
    return super._readScalarValue(type);
  }
}

/** Parses one crate layer into the spec table USDComposer consumes. */
export function parseCrate(bytes: Uint8Array): UsdLayerData {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  return new CrateParser().parseData(buffer as ArrayBuffer);
}
