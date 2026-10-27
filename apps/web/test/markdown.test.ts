import { describe, expect, it } from 'vitest';
import { MAX_MARKDOWN_CHARS, markdownToText, parseInline, parseMarkdownLite } from '../src/scene/markdown';

const text = (v: string) => ({ t: 'text', v });

describe('parseInline', () => {
  it('reads bold, italic and nesting', () => {
    expect(parseInline('a **b** c')).toEqual([text('a '), { t: 'strong', c: [text('b')] }, text(' c')]);
    expect(parseInline('*it* and _it_')).toEqual([{ t: 'em', c: [text('it')] }, text(' and '), { t: 'em', c: [text('it')] }]);
    expect(parseInline('**a *b* c**')).toEqual([{ t: 'strong', c: [text('a '), { t: 'em', c: [text('b')] }, text(' c')] }]);
    expect(parseInline('*a **b** c*')).toEqual([{ t: 'em', c: [text('a '), { t: 'strong', c: [text('b')] }, text(' c')] }]);
  });

  it('leaves things that are not emphasis alone', () => {
    for (const s of ['2 * 3 * 4', 'snake_case_name', '**', '** not bold**', '**open', '*open', 'a * b', '_x', 'x_ y_', '***']) expect(parseInline(s)).toEqual([text(s)]);
    // A closer needs a non-space before it.
    expect(parseInline('**a **')).toEqual([text('**a **')]);
    expect(parseInline('*a *')).toEqual([text('*a *')]);
  });

  it('supports backslash escapes', () => {
    expect(parseInline('\\*not\\* \\\\ \\_x\\_')).toEqual([text('*not* \\ _x_')]);
    expect(parseInline('**a \\** b**')).toEqual([{ t: 'strong', c: [text('a ** b')] }]);
    expect(parseInline('trailing \\')).toEqual([text('trailing \\')]);
    expect(parseInline('\\n')).toEqual([text('\\n')]);
  });

  it('does not nest bold in bold or italic in italic', () => {
    expect(parseInline('*a _b_ c*')).toEqual([{ t: 'em', c: [text('a _b_ c')] }]);
  });
});

describe('parseMarkdownLite', () => {
  it('splits paragraphs, line breaks and bullet lists', () => {
    const blocks = parseMarkdownLite('Short-nose design.\nFits most riders.\n\n- Swap in **30 days**\n* Fitting\n• Free\r\nAfter the list');
    expect(blocks).toEqual([
      { t: 'p', c: [text('Short-nose design.'), { t: 'br' }, text('Fits most riders.')] },
      { t: 'ul', items: [[text('Swap in '), { t: 'strong', c: [text('30 days')] }], [text('Fitting')], [text('Free')]] },
      { t: 'p', c: [text('After the list')] },
    ]);
  });

  it('ends a list at a blank line and handles empty input', () => {
    expect(parseMarkdownLite('- a\n\n- b')).toEqual([
      { t: 'ul', items: [[text('a')]] },
      { t: 'ul', items: [[text('b')]] },
    ]);
    expect(parseMarkdownLite('')).toEqual([]);
    expect(parseMarkdownLite('  \n\n ')).toEqual([]);
    // "-x" is not a bullet.
    expect(parseMarkdownLite('-x')).toEqual([{ t: 'p', c: [text('-x')] }]);
  });

  it('keeps markup-looking text as text (rendering never uses innerHTML)', () => {
    const evil = '<img src=x onerror=alert(1)> **<script>alert(1)</script>**';
    expect(parseMarkdownLite(evil)).toEqual([{ t: 'p', c: [text('<img src=x onerror=alert(1)> '), { t: 'strong', c: [text('<script>alert(1)</script>')] }] }]);
  });

  it('caps very long input', () => {
    const blocks = parseMarkdownLite('a'.repeat(MAX_MARKDOWN_CHARS + 50));
    expect((blocks[0] as { c: { v: string }[] }).c[0].v).toHaveLength(MAX_MARKDOWN_CHARS);
  });
});

describe('markdownToText', () => {
  it('strips markers and keeps structure', () => {
    expect(markdownToText('**Bold** and *it*\nnext\n\n- one\n- _two_')).toBe('Bold and it\nnext\n• one\n• two');
  });
});
