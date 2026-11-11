import { describe, expect, it } from 'vitest';
import { SCHEMA, parseScene } from '../src/scene/schema';
import { SPEC_DEFAULT_LABELS, SPEC_LIMITS, cleanSpecs, parseSpecs, specsForEdit, visibleSpecs } from '../src/scene/specs';

const base = { schema: SCHEMA, id: 'b', name: 'B', model: { url: 'demo:road', format: 'demo' } };

describe('spec sheet', () => {
  it('cleans rows: trims, cuts overlong text, drops empty rows, caps the row count', () => {
    expect(cleanSpecs([{ label: '  Weight ', value: ' 8.2 kg ' }, { label: ' ', value: '' }, { label: '', value: 'Made in Portugal' }])).toEqual([
      { label: 'Weight', value: '8.2 kg' },
      { label: '', value: 'Made in Portugal' },
    ]);
    const [long] = cleanSpecs([{ label: 'x'.repeat(500), value: 'y'.repeat(500) }]);
    expect([long.label.length, long.value.length]).toEqual([SPEC_LIMITS.label, SPEC_LIMITS.value]);
    expect(cleanSpecs(Array.from({ length: 100 }, (_, i) => ({ label: `L${i}`, value: 'v' })))).toHaveLength(SPEC_LIMITS.rows);
  });

  it('parses leniently: malformed rows are dropped, never the scene', () => {
    expect(parseSpecs(undefined)).toBeUndefined();
    expect(parseSpecs('Carbon')).toBeUndefined();
    expect(parseSpecs([null, 3, { label: 'Weight' }, { label: 1, value: 'x' }, { label: '', value: ' ' }])).toBeUndefined();
    expect(parseSpecs([{ label: 'Groupset', value: 'GRX', extra: true }, 'junk'])).toEqual([{ label: 'Groupset', value: 'GRX' }]);
  });

  it('is an optional scene field: kept when valid, absent otherwise', () => {
    expect(parseScene(base).specs).toBeUndefined();
    expect(parseScene({ ...base, specs: { weight: '8 kg' } }).specs).toBeUndefined();
    expect(parseScene({ ...base, specs: [{ label: 'Sizes', value: 'S–XL' }, { label: 'x' }] }).specs).toEqual([{ label: 'Sizes', value: 'S–XL' }]);
  });

  it('edits start from the default labels; customers only see rows with a value', () => {
    expect(specsForEdit(undefined)).toEqual(SPEC_DEFAULT_LABELS.map((label) => ({ label, value: '' })));
    expect(specsForEdit([])).toHaveLength(SPEC_DEFAULT_LABELS.length);
    const saved = [{ label: 'Weight', value: '8 kg' }];
    const copy = specsForEdit(saved);
    expect(copy).toEqual(saved);
    expect(copy[0]).not.toBe(saved[0]);
    expect(visibleSpecs(undefined)).toEqual([]);
    expect(visibleSpecs([{ label: 'Weight', value: ' ' }, { label: '', value: 'Lifetime warranty' }])).toEqual([{ label: '', value: 'Lifetime warranty' }]);
  });
});
