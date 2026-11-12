import type { SpecRow } from './schema';

// The spec sheet: a short label/value table of key specs, shown on the first (whole bike) step of
// Present mode. Free text on both sides ("8.2 kg (size 56)", "XS–XL"), in the order staff typed it.

/** Rows a new spec sheet starts with in Edit mode; staff fill, rename or delete them. */
export const SPEC_DEFAULT_LABELS = ['Frame material', 'Groupset', 'Weight', 'Sizes'] as const;
/** Generous for a table customers read on a phone, small enough to keep a scene file sane. */
export const SPEC_LIMITS = { rows: 40, label: 60, value: 240 } as const;

/** Trims every row, cuts overlong text and drops rows with neither a label nor a value. */
export function cleanSpecs(rows: readonly SpecRow[]): SpecRow[] {
  return rows
    .map((r) => ({ label: r.label.trim().slice(0, SPEC_LIMITS.label), value: r.value.trim().slice(0, SPEC_LIMITS.value) }))
    .filter((r) => r.label || r.value)
    .slice(0, SPEC_LIMITS.rows);
}

/** Lenient, like the crop box: malformed rows are dropped, never the scene. Undefined when nothing is left. */
export function parseSpecs(v: unknown): SpecRow[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const rows = v.filter((r): r is SpecRow => typeof r === 'object' && r !== null && typeof r.label === 'string' && typeof r.value === 'string');
  const out = cleanSpecs(rows);
  return out.length ? out : undefined;
}

/** What the editor shows: the saved rows, or the default labels for a bike without a sheet yet. */
export function specsForEdit(specs: readonly SpecRow[] | undefined): SpecRow[] {
  return specs?.length ? specs.map((r) => ({ ...r })) : SPEC_DEFAULT_LABELS.map((label) => ({ label, value: '' }));
}

/** What customers see: only rows with a value (an unlabelled value still shows). */
export function visibleSpecs(specs: readonly SpecRow[] | undefined): SpecRow[] {
  return (specs ?? []).filter((r) => r.value.trim());
}

/** Rows shown before the "All specs" toggle, so the card stays clear of the bike on a laptop screen. */
export const SPEC_COLLAPSED_ROWS = 4;

/** Collapse only when it hides at least two rows; a toggle for one hidden row saves nothing. */
export function specsCollapsible(count: number): boolean {
  return count > SPEC_COLLAPSED_ROWS + 1;
}
