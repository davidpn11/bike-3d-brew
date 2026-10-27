// Pure helpers for sync-content.mjs (tested by lib.test.mjs with `node --test`).
import path from 'node:path';

/**
 * Splits markdown into fenced code blocks and text chunks so transforms never touch code.
 * @returns {{ code: boolean, text: string }[]}
 */
export function splitFences(md) {
  const parts = [];
  let buf = [];
  let fence = null; // the opening marker, e.g. "```" or "~~~~"
  const flush = (code) => {
    if (buf.length) parts.push({ code, text: buf.join('\n') });
    buf = [];
  };
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && m) {
      flush(false);
      fence = m[1];
      buf.push(line);
    } else if (fence && m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
      buf.push(line);
      flush(true);
      fence = null;
    } else {
      buf.push(line);
    }
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
  flush(fence !== null);
  return parts;
}

/** Applies `fn` to text outside inline code spans. */
function outsideInlineCode(text, fn) {
  return text
    .split(/(`+[^`]*?`+)/g)
    .map((seg, i) => (i % 2 ? seg : fn(seg)))
    .join('');
}

/**
 * Rewrites repo-relative markdown links: files that became pages point at their page, anything
 * else at the file on GitHub, so links work both on GitHub and on the site.
 * @param {string} target link target as written
 * @param {string} from repo-relative path of the file containing the link
 * @param {Map<string, string>} pages repo path → site URL
 */
export function rewriteLink(target, from, pages, repoUrl) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const hashAt = target.indexOf('#');
  const file = hashAt < 0 ? target : target.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : target.slice(hashAt);
  if (!file) return target;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), file)).replace(/\/$/, '');
  if (resolved.startsWith('..')) return target;
  const page = pages.get(resolved);
  if (page) return page + hash;
  return `${repoUrl}/blob/develop/${resolved}${hash}`;
}

/**
 * Turns a repo markdown file into page markdown (.md, not .mdx, so `<`, `{` and stray HTML can
 * never break the MDX compiler). Pulls the first H1 out as the title.
 */
export function transformMarkdown(md, { from, pages, repoUrl }) {
  let title = null;
  const out = splitFences(md).map((part) => {
    if (part.code) return part.text;
    let text = part.text.replace(/<!--[\s\S]*?-->/g, '');
    if (title === null) {
      text = text.replace(/^#[ \t]+(.+?)[ \t#]*$/m, (_, t) => {
        title = t;
        return '';
      });
    }
    const fix = (t) => rewriteLink(t, from, pages, repoUrl);
    text = text.replace(/^( {0,3}\[[^\]]+\]:[ \t]*)(\S+)/gm, (_, pre, t) => pre + fix(t));
    text = outsideInlineCode(text, (seg) => seg.replace(/(\]\()(<[^>]*>|[^)\s]+)/g, (_, pre, t) => pre + fix(t)));
    // `[~]` (in progress) is not GFM; show it as an unchecked box with a label.
    text = text.replace(/^(\s*[-*+]\s+)\[~\]\s+/gm, '$1[ ] _(in progress)_ ');
    return text;
  });
  return { title: title ? stripInline(title) : null, body: out.join('\n').replace(/^\s*\n/, '') };
}

/** Plain text from inline markdown (for titles and labels). */
export function stripInline(s) {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();
}

const STATUS = { ' ': 'open', x: 'done', X: 'done', '~': 'progress' };

/**
 * Parses ROADMAP.md into milestones. Only `##` sections with checkbox items count; the item name
 * is the leading **bold** text when there is one.
 */
export function parseRoadmap(md) {
  const milestones = [];
  let current = null;
  for (const part of splitFences(md)) {
    if (part.code) continue;
    for (const line of part.text.split('\n')) {
      const h = /^##[ \t]+(.+?)[ \t#]*$/.exec(line);
      if (h) {
        current = { title: stripInline(h[1]), items: [] };
        milestones.push(current);
        continue;
      }
      const it = /^\s*[-*+]\s+\[([ xX~])\]\s+(.*)$/.exec(line);
      if (!it || !current) continue;
      const text = it[2].trim();
      const bold = /^\*\*(.+?)\*\*[:.]?\s*(.*)$/.exec(text);
      current.items.push({
        status: STATUS[it[1]],
        name: bold ? bold[1] : text,
        detail: bold ? bold[2].charAt(0).toUpperCase() + bold[2].slice(1) : '',
      });
    }
  }
  return milestones
    .filter((m) => m.items.length)
    .map((m) => ({ ...m, counts: count(m.items) }));
}

function count(items) {
  const c = { done: 0, progress: 0, open: 0, total: items.length };
  for (const i of items) c[i.status]++;
  return c;
}

export function roadmapTotals(milestones) {
  return count(milestones.flatMap((m) => m.items));
}

/** Parses CHANGELOG.md: `##` releases, `###` categories, top-level bullets as entries. */
export function parseChangelog(md) {
  const releases = [];
  let rel = null;
  let category = '';
  let entry = null;
  for (const part of splitFences(md)) {
    if (part.code) continue;
    for (const line of part.text.split('\n')) {
      let m;
      if ((m = /^##[ \t]+(.+?)[ \t#]*$/.exec(line))) {
        rel = { title: stripInline(m[1]), entries: [] };
        releases.push(rel);
        category = '';
        entry = null;
      } else if ((m = /^###[ \t]+(.+?)[ \t#]*$/.exec(line))) {
        category = stripInline(m[1]);
        entry = null;
      } else if (rel && (m = /^[-*+]\s+(.*)$/.exec(line))) {
        entry = { category, text: m[1].trim() };
        rel.entries.push(entry);
      } else if (entry && /^\s+\S/.test(line)) {
        entry.text += ' ' + line.trim();
      } else if (!line.trim()) {
        entry = null;
      }
    }
  }
  return releases.filter((r) => r.entries.length);
}

/** File name → URL slug: "MANUAL-STEPS.md" → "manual-steps". */
export function slugOf(file) {
  return path.posix
    .basename(file)
    .replace(/\.mdx?$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
