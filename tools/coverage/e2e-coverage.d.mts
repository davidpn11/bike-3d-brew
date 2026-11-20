// Types for e2e-coverage.mjs so the TypeScript E2E setup can import it.
export const E2E_DIR: string;
export const RAW_DIR: string;
export function convertE2eCoverage(): Promise<string | null>;
export const THRESHOLDS: Record<'lines' | 'statements' | 'functions' | 'branches', number>;
type Loc = { start: { line: number; column: number }; end: { line: number; column: number } };
type FileCov = {
  path: string;
  statementMap: Record<string, Loc>;
  s: Record<string, number>;
  fnMap: Record<string, { name: string; decl: Loc; loc: Loc; line: number }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc: Loc; type: string; locations: Loc[]; line: number }>;
  b: Record<string, number[]>;
};
export function alignTo(unit: FileCov, e2e: FileCov): FileCov;
