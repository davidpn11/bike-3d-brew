import { describe, expect, it } from 'vitest';
import { EMBED_PROTOCOL, embedOrigin, parseArea, parseEmbedCommand } from '../src/scene/embed';

const msg = (m: Record<string, unknown>) => parseEmbedCommand({ type: EMBED_PROTOCOL, ...m });

describe('parseEmbedCommand', () => {
  it('accepts the closed set of commands', () => {
    for (const cmd of ['next', 'prev', 'play', 'pause', 'getState']) expect(msg({ cmd, extra: 'ignored' })).toEqual({ cmd });
    expect(msg({ cmd: 'goToArea', area: 2 })).toEqual({ cmd: 'goToArea', area: 2 });
    expect(msg({ cmd: 'goToArea', area: -1 })).toEqual({ cmd: 'goToArea', area: -1 });
    expect(msg({ cmd: 'goToArea', area: 'hs-fork' })).toEqual({ cmd: 'goToArea', area: 'hs-fork' });
    expect(msg({ cmd: 'goToArea', area: null })).toEqual({ cmd: 'goToArea', area: null });
    expect(msg({ cmd: 'setBackground', background: 'green' })).toEqual({ cmd: 'setBackground', background: 'green' });
    expect(msg({ cmd: 'openComment', id: 'note-1' })).toEqual({ cmd: 'openComment', id: 'note-1' });
  });

  it('ignores anything else', () => {
    for (const data of [null, undefined, 'next', 42, [], { cmd: 'next' }, { type: 'bike-embed/2', cmd: 'next' }, { type: EMBED_PROTOCOL }]) expect(parseEmbedCommand(data)).toBeNull();
    expect(msg({ cmd: 'eval' })).toBeNull();
    expect(msg({ cmd: 'toString' })).toBeNull();
    expect(msg({ cmd: 'goToArea', area: 1.5 })).toBeNull();
    expect(msg({ cmd: 'goToArea', area: Number.NaN })).toBeNull();
    expect(msg({ cmd: 'goToArea', area: '' })).toBeNull();
    expect(msg({ cmd: 'goToArea', area: { id: 'x' } })).toBeNull();
    expect(msg({ cmd: 'goToArea' })).toBeNull();
    expect(msg({ cmd: 'setBackground', background: 'url(evil)' })).toBeNull();
    expect(msg({ cmd: 'openComment', id: 'x'.repeat(201) })).toBeNull();
    expect(msg({ cmd: 'openComment' })).toBeNull();
  });
});

describe('parseArea', () => {
  it('reads indexes and hotspot ids', () => {
    expect(parseArea(null)).toBeNull();
    expect(parseArea(undefined)).toBeNull();
    expect(parseArea('  ')).toBeNull();
    expect(parseArea('3')).toBe(3);
    expect(parseArea(' hs-fork ')).toBe('hs-fork');
    expect(parseArea('-1')).toBe('-1');
    expect(parseArea('x'.repeat(300))).toHaveLength(200);
  });
});

describe('embedOrigin', () => {
  it('talks to any parent when no origin is given', () => {
    for (const raw of [null, '', ' ']) {
      const o = embedOrigin(raw);
      expect(o.target).toBe('*');
      expect(o.accepts('https://anything.example')).toBe(true);
    }
  });

  it('restricts to one origin', () => {
    const o = embedOrigin('https://shop.example/bikes/aero?x=1');
    expect(o.target).toBe('https://shop.example');
    expect(o.accepts('https://shop.example')).toBe(true);
    expect(o.accepts('https://evil.example')).toBe(false);
    expect(o.accepts('http://shop.example')).toBe(false);
  });

  it('fails closed on a bad origin', () => {
    for (const raw of ['shop.example', 'javascript:alert(1)', 'file:///etc']) {
      const o = embedOrigin(raw);
      expect(o.accepts('https://shop.example')).toBe(false);
      expect(o.target).toBe('https://invalid.invalid');
    }
  });
});
