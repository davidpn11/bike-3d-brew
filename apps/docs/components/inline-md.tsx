import type { ReactNode } from 'react';
import { repoUrl } from '@/lib/site';

// Just enough inline markdown for roadmap items and changelog lines: `code`, **bold**,
// _em_/*em*, [links](url) and PR refs (#12). Everything else stays text, so no HTML injection.
const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|((?<![\w*])[*_][^*_]+[*_](?![\w*]))|((?<![\w&])#\d+\b)/g;

export function InlineMd({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [tok] = m;
    if (m[1]) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const safe = /^(https?:|#)/.test(href) ? href : `${repoUrl}/blob/develop/${href.replace(/^\.\//, '')}`;
      out.push(
        <a key={key++} href={safe} className="underline underline-offset-2">
          {label}
        </a>,
      );
    } else if (m[4]) out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else if (m[5])
      out.push(
        <a key={key++} href={`${repoUrl}/pull/${tok.slice(1)}`} className="underline underline-offset-2">
          {tok}
        </a>,
      );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
