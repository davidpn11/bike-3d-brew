import { BACKGROUND_MODES, type BackgroundMode } from './schema';

// The embed protocol (`bike-embed/1`): what a shop's page may tell `embed.html` through
// `postMessage`, and what the embed tells it back. Messages are untrusted input from any page that
// frames us, so they are parsed into a closed set of commands; anything else is ignored.

export const EMBED_PROTOCOL = 'bike-embed/1' as const;

/** `null` is the whole bike; a number is an index in Present order (0 = whole bike); a string is a hotspot id. */
export type AreaRef = number | string | null;

export type EmbedCommand =
  | { cmd: 'goToArea'; area: AreaRef }
  | { cmd: 'next' | 'prev' | 'play' | 'pause' }
  | { cmd: 'getState' }
  | { cmd: 'setBackground'; background: BackgroundMode }
  | { cmd: 'openComment'; id: string };

/** Posted to the parent: `{ type: 'bike-embed/1', event, detail }`. */
export type EmbedEventName = 'ready' | 'error' | 'areachange' | 'commentopen' | 'state';

const SIMPLE = new Set(['next', 'prev', 'play', 'pause', 'getState']);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** Parses an `area` attribute or `?area=` value: digits are an index, anything else a hotspot id. */
export function parseArea(raw: string | null | undefined): AreaRef {
  const v = raw?.trim();
  if (!v) return null;
  return /^\d{1,4}$/.test(v) ? Number(v) : v.slice(0, 200);
}

/** Validates a received message; returns null for anything that is not a well-formed command. */
export function parseEmbedCommand(data: unknown): EmbedCommand | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== EMBED_PROTOCOL || typeof m.cmd !== 'string') return null;
  if (SIMPLE.has(m.cmd)) return { cmd: m.cmd as 'next' | 'getState' };
  switch (m.cmd) {
    case 'goToArea':
      if (m.area === null || isId(m.area)) return { cmd: 'goToArea', area: m.area };
      return Number.isInteger(m.area) ? { cmd: 'goToArea', area: m.area as number } : null;
    case 'setBackground':
      return BACKGROUND_MODES.includes(m.background as BackgroundMode) ? { cmd: 'setBackground', background: m.background as BackgroundMode } : null;
    case 'openComment':
      return isId(m.id) ? { cmd: 'openComment', id: m.id } : null;
  }
  return null;
}

/**
 * `?origin=`: the one parent origin the embed talks to. Without it the embed accepts commands from
 * whatever page frames it and posts events to any origin (they only carry the public scene's names
 * and ids). An origin that does not parse matches nothing, so a typo fails closed.
 */
export function embedOrigin(raw: string | null): { target: string; accepts: (origin: string) => boolean } {
  if (raw === null || raw.trim() === '') return { target: '*', accepts: () => true };
  let origin: string | null = null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol === 'https:' || u.protocol === 'http:') origin = u.origin;
  } catch {
    /* fails closed below */
  }
  // postMessage needs a valid target; this one never matches a real parent.
  if (!origin) return { target: 'https://invalid.invalid', accepts: () => false };
  return { target: origin, accepts: (o) => o === origin };
}
