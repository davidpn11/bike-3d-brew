import { describe, expect, it } from 'vitest';
import { alignTo } from '../../../tools/coverage/e2e-coverage.mjs';

const loc = (line: number, from: number, to: number) => ({ start: { line, column: from }, end: { line, column: to } });
const fn = (line: number) => ({ name: `f${line}`, decl: loc(line, 9, 10), loc: loc(line, 0, 40), line });
const br = (line: number) => ({ loc: loc(line, 0, 30), type: 'if', locations: [loc(line, 0, 30), loc(line, 0, 30)], line });

describe('merging E2E coverage into the unit report', () => {
  it('keeps only the locations the unit report has, with the E2E counts', () => {
    const unit = { path: '/a.ts', statementMap: { 0: loc(1, 0, 20), 1: loc(2, 2, 12) }, s: { 0: 1, 1: 0 }, fnMap: { 0: fn(1) }, f: { 0: 1 }, branchMap: { 0: br(2) }, b: { 0: [1, 0] } };
    // The build placed statement 2 one column off and has a statement Vitest's transform does not.
    const e2e = {
      path: '/a.ts',
      statementMap: { 0: loc(1, 0, 20), 1: loc(2, 3, 12), 2: loc(3, 0, 5) },
      s: { 0: 4, 1: 2, 2: 0 },
      fnMap: { 0: fn(1), 1: fn(5) },
      f: { 0: 4, 1: 0 },
      branchMap: { 0: br(2) },
      b: { 0: [0, 3] },
    };
    const out = alignTo(unit, e2e);
    expect(out.statementMap).toEqual({ 0: loc(1, 0, 20) });
    expect(out.s).toEqual({ 0: 4 });
    expect(out.f).toEqual({ 0: 4 });
    expect(out.b).toEqual({ 0: [0, 3] });
    expect(out.path).toBe('/a.ts');
  });
});
