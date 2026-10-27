// three.js ships its USD parsers (r186) without type declarations. Only what ./ uses is typed;
// the underscore methods are internal to three and may change on upgrade (pinned in package.json,
// covered by apps/web/test/usdz.test.ts).

declare module 'three/examples/jsm/loaders/usd/USDCParser.js' {
  export interface UsdSpec {
    specType: number;
    fields: Record<string, unknown>;
  }
  export interface UsdLayerData {
    specsByPath: Record<string, UsdSpec>;
  }
  export interface CrateValueRep {
    readonly typeEnum: number;
    readonly isArray: boolean;
    readonly isInlined: boolean;
    readonly payload: number;
    getInlinedValue(): number;
  }
  export interface CrateReader {
    readUint16(): number;
    readInt32(): number;
    readFloat64(): number;
  }
  export class USDCParser {
    protected reader: CrateReader;
    protected _conversionView: DataView;
    parseData(buffer: ArrayBuffer): UsdLayerData;
    protected _readInlinedValue(rep: CrateValueRep): unknown;
    protected _readScalarValue(type: number): unknown;
    protected _readHalf(): number;
    protected _halfToFloat(h: number): number;
  }
}

declare module 'three/examples/jsm/loaders/usd/USDAParser.js' {
  import type { UsdLayerData } from 'three/examples/jsm/loaders/usd/USDCParser.js';
  export class USDAParser {
    parseData(text: string): UsdLayerData;
  }
}

declare module 'three/examples/jsm/loaders/usd/USDComposer.js' {
  import type { Group, LoadingManager } from 'three';
  import type { UsdLayerData } from 'three/examples/jsm/loaders/usd/USDCParser.js';
  export type NumArray = ArrayLike<number>;
  export class USDComposer {
    constructor(manager?: LoadingManager);
    texturePromises: Promise<void>[];
    compose(data: UsdLayerData, assets: Record<string, unknown>, variantSelections: Record<string, string>, basePath: string): Group;
    protected _triangulateIndicesWithPattern(
      indices: NumArray,
      counts: NumArray,
      points?: NumArray | null,
      holeMap?: { holeFaces: Set<number>; parentToHoles: Map<number, number[]> } | null,
    ): { indices: NumArray; pattern: NumArray };
    protected _applyTriangulationPattern(indices: NumArray, pattern: NumArray): NumArray;
    protected _expandAttribute(data: NumArray, indices: NumArray, itemSize: number): NumArray;
  }
}
