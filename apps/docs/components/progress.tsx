import Link from 'next/link';
import { InlineMd } from '@/components/inline-md';
import { LocalTime } from '@/components/local-time';
import { repoUrl } from '@/lib/site';
import { type Counts, type Milestone, type RoadmapItem, type Status, siteData } from '@/lib/site-data';

const STATUS: Record<Status, { label: string; badge: string }> = {
  done: { label: 'Done', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30' },
  progress: { label: 'In progress', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30' },
  open: { label: 'Open', badge: 'bg-fd-muted text-fd-muted-foreground ring-fd-border' },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.badge}`}>{s.label}</span>;
}

const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);

export function ProgressBar({ counts, label }: { counts: Counts; label: string }) {
  const done = pct(counts.done, counts.total);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={counts.total}
      aria-valuenow={counts.done}
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-fd-muted"
    >
      <div className="h-full bg-emerald-500" style={{ width: `${done}%` }} />
      <div className="h-full bg-amber-400" style={{ width: `${pct(counts.progress, counts.total)}%` }} />
    </div>
  );
}

export function CountsLine({ counts }: { counts: Counts }) {
  return (
    <p className="text-sm text-fd-muted-foreground">
      <span className="font-medium text-fd-foreground">
        {counts.done}/{counts.total} done
      </span>
      {counts.progress ? ` · ${counts.progress} in progress` : ''} · {counts.open} open
    </p>
  );
}

/** "Milestone 2: Real captures" → ["Milestone 2", "Real captures"]. */
function splitTitle(title: string): [string | null, string] {
  const m = /^([^:]{1,24}):\s*(.+)$/.exec(title);
  return m ? [m[1], m[2]] : [null, title];
}

export const milestoneId = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function MilestoneCard({ milestone, href }: { milestone: Milestone; href?: string }) {
  const [kicker, name] = splitTitle(milestone.title);
  const body = (
    <>
      {kicker ? <p className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">{kicker}</p> : null}
      <p className="font-semibold">{name}</p>
      <div className="mt-3">
        <ProgressBar counts={milestone.counts} label={`${milestone.title}: ${milestone.counts.done} of ${milestone.counts.total} done`} />
      </div>
      <div className="mt-2">
        <CountsLine counts={milestone.counts} />
      </div>
    </>
  );
  const cls = 'block rounded-xl border border-fd-border bg-fd-card p-4 text-fd-card-foreground';
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:bg-fd-accent`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function ItemList({ items }: { items: RoadmapItem[] }) {
  return (
    <ul className="divide-y divide-fd-border rounded-xl border border-fd-border bg-fd-card">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 p-3">
          <StatusBadge status={item.status} />
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              <InlineMd text={item.name} />
            </p>
            {item.detail ? (
              <p className="mt-1 text-fd-muted-foreground">
                <InlineMd text={item.detail} />
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TotalsCard() {
  const { totals } = siteData.roadmap;
  const share = Math.round(pct(totals.done, totals.total));
  return (
    <div className="rounded-xl border border-fd-border bg-fd-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">Overall</p>
        <p className="text-2xl font-bold tabular-nums">{share}%</p>
      </div>
      <div className="mt-3">
        <ProgressBar counts={totals} label={`Roadmap: ${totals.done} of ${totals.total} items done`} />
      </div>
      <div className="mt-2">
        <CountsLine counts={totals} />
      </div>
    </div>
  );
}

export function LatestChanges({ limit = 6 }: { limit?: number }) {
  const release = siteData.changelog[0];
  if (!release) return <p className="text-sm text-fd-muted-foreground">No changelog entries yet.</p>;
  return (
    <div className="rounded-xl border border-fd-border bg-fd-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">{release.title}</p>
      <ul className="mt-2 space-y-2 text-sm">
        {release.entries.slice(0, limit).map((e, i) => (
          <li key={i} className="flex gap-2">
            {e.category ? <span className="shrink-0 font-medium text-fd-muted-foreground">{e.category}</span> : null}
            <span className="min-w-0">
              <InlineMd text={e.text} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BuildInfo() {
  const b = siteData.build;
  return (
    <p className="text-xs text-fd-muted-foreground">
      Updated <LocalTime iso={b.builtAt} />
      {b.sha ? (
        <>
          {' from '}
          <a className="font-mono underline underline-offset-2" href={`${repoUrl}/commit/${b.sha}`}>
            {b.sha}
          </a>
          {b.dirty ? '+local changes' : ''}
        </>
      ) : null}
      {b.branch && b.branch !== 'HEAD' ? (
        <>
          {' on '}
          <span className="font-mono">{b.branch}</span>
        </>
      ) : null}
    </p>
  );
}

/** Body of /docs/progress (rendered from the generated progress.mdx). */
export function ProgressPage() {
  const { milestones } = siteData.roadmap;
  return (
    <div className="not-prose flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <TotalsCard />
        <BuildInfo />
      </div>
      {milestones.map((m) => (
        <section key={m.title} id={milestoneId(m.title)} className="flex scroll-mt-24 flex-col gap-3">
          <h2 className="text-lg font-semibold">{m.title}</h2>
          <ProgressBar counts={m.counts} label={`${m.title}: ${m.counts.done} of ${m.counts.total} done`} />
          <CountsLine counts={m.counts} />
          <ItemList items={m.items} />
        </section>
      ))}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Latest changes</h2>
        <LatestChanges limit={20} />
        <Link href="/docs/changelog/" className="text-sm underline underline-offset-2">
          Full changelog
        </Link>
      </section>
    </div>
  );
}
