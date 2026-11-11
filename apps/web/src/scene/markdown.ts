// Markdown-lite for comment bodies: **bold**, *italic* / _italic_, "- " bullet lists and line
// breaks. Parsed into a tiny tree that the UI turns into DOM nodes with textContent only, so user
// text can never become markup (see ui/markdown.ts). Anything that does not parse stays literal.

export type Inline = { t: 'text'; v: string } | { t: 'strong'; c: Inline[] } | { t: 'em'; c: Inline[] } | { t: 'br' };
export type Block = { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] };

/** Bodies are short sales notes; the cap keeps a pasted novel from costing anything. */
export const MAX_MARKDOWN_CHARS = 4000;

const BULLET = /^\s*[-*•]\s+(.*)$/;

export function parseMarkdownLite(src: string): Block[] {
  const lines = src.slice(0, MAX_MARKDOWN_CHARS).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let items: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: joinLines(para) });
    para = [];
  };
  const flushList = () => {
    if (items.length) blocks.push({ t: 'ul', items: items.map((s) => parseInline(s)) });
    items = [];
  };
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      items.push(bullet[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function joinLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, i) => {
    if (i) out.push({ t: 'br' });
    out.push(...parseInline(line));
  });
  return out;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Index of the closing marker for an opener at `from`, or -1. Closers need a non-space before them. */
function findClose(s: string, marker: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (!s.startsWith(marker, i) || isSpace(s[i - 1])) continue;
    // A single `*` must not be half of a `**`.
    if (marker === '*' && (s[i + 1] === '*' || s[i - 1] === '*')) continue;
    // `_` only closes at a word boundary, so snake_case_names stay literal.
    if (marker === '_' && isWord(s[i + 1])) continue;
    return i;
  }
  return -1;
}

export function parseInline(s: string, inStrong = false, inEm = false): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const push = (node: Inline) => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
    out.push(node);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && /[*_\\]/.test(s[i + 1])) {
      text += s[++i];
      continue;
    }
    if (!inStrong && s.startsWith('**', i) && !isSpace(s[i + 2])) {
      const end = findClose(s, '**', i + 3);
      if (end > 0) {
        push({ t: 'strong', c: parseInline(s.slice(i + 2, end), true, inEm) });
        i = end + 1;
        continue;
      }
    }
    const em = c === '*' || (c === '_' && !isWord(s[i - 1]));
    if (!inEm && em && s[i + 1] !== c && !isSpace(s[i + 1])) {
      const end = findClose(s, c, i + 2);
      if (end > 0) {
        push({ t: 'em', c: parseInline(s.slice(i + 1, end), inStrong, true) });
        i = end;
        continue;
      }
    }
    text += c;
  }
  if (text) out.push({ t: 'text', v: text });
  return out;
}

/** The body as plain text (markers removed): for titles, aria labels and previews. */
export function markdownToText(src: string): string {
  const flat = (nodes: Inline[]): string => nodes.map((n) => (n.t === 'text' ? n.v : n.t === 'br' ? '\n' : flat(n.c))).join('');
  return parseMarkdownLite(src)
    .map((b) => (b.t === 'p' ? flat(b.c) : b.items.map((it) => `• ${flat(it)}`).join('\n')))
    .join('\n');
}
