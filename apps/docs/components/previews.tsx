'use client';
import { useEffect, useState } from 'react';
import { repoUrl, siteRoot } from '@/lib/site';

interface Preview {
  number: number;
  title: string;
  branch: string;
  sha: string;
}

/**
 * Open PR previews, read at runtime from <siteRoot>/pr/index.json (written to gh-pages by
 * tools/publish-pages.sh), so the list stays current without rebuilding the main site.
 */
export function PrPreviews() {
  const [previews, setPreviews] = useState<Preview[]>([]);
  useEffect(() => {
    fetch(`${siteRoot}/pr/index.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => {
        if (!Array.isArray(list)) return;
        setPreviews(
          list
            .filter((p) => Number.isInteger(p?.number) && p.number > 0)
            .map((p) => ({ number: p.number, title: String(p.title ?? ''), branch: String(p.branch ?? ''), sha: String(p.sha ?? '') })),
        );
      })
      .catch(() => {});
  }, []);
  if (!previews.length) return null;
  return (
    <section className="not-prose flex flex-col gap-3">
      <h2 className="text-xl font-semibold">PR previews</h2>
      <p className="text-sm text-fd-muted-foreground">Each open pull request, built and published so it can be tried before merging.</p>
      <ul className="flex flex-col gap-2">
        {previews.map((p) => (
          <li key={p.number} className="flex flex-col gap-1 rounded-xl border border-fd-border bg-fd-card p-3 text-sm">
            <p className="font-medium">
              <a className="underline underline-offset-2" href={`${repoUrl}/pull/${p.number}`}>
                #{p.number}
              </a>{' '}
              {p.title}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <a className="underline underline-offset-2" href={`${siteRoot}/pr/${p.number}/app/`}>
                Viewer
              </a>
              <a className="underline underline-offset-2" href={`${siteRoot}/pr/${p.number}/`}>
                Docs
              </a>
              <span className="font-mono text-xs text-fd-muted-foreground">
                {p.branch} {p.sha}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
