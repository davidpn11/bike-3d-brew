import Link from 'next/link';
import { BuildInfo, LatestChanges, MilestoneCard, TotalsCard, milestoneId } from '@/components/progress';
import { InlineMd } from '@/components/inline-md';
import { demoUrl } from '@/lib/site';
import { siteData } from '@/lib/site-data';

// What the owner sees first, usually on a phone: where the project stands and how to try it.
export default function HomePage() {
  const { milestones } = siteData.roadmap;
  const items = milestones.flatMap((m) => m.items.map((item) => ({ ...item, milestone: m.title })));
  const inProgress = items.filter((i) => i.status === 'progress');
  const next = items.filter((i) => i.status === 'open').slice(0, 3);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">bike-3d-brew</h1>
        <p className="text-fd-muted-foreground">
          Capture a bike with an iPhone, show it as a background-free 3D model in the browser, zoom into the fork, drivetrain or cockpit and pin sales
          comments on it.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={demoUrl} className="rounded-lg bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground">
            Open live demo
          </a>
          <Link href="/docs/testing-guide/" className="rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 text-sm font-medium">
            How to test
          </Link>
          <Link href="/docs/" className="rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 text-sm font-medium">
            Docs
          </Link>
        </div>
        <BuildInfo />
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Progress</h2>
          <Link href="/docs/progress/" className="text-sm underline underline-offset-2">
            All items
          </Link>
        </div>
        <TotalsCard />
        <div className="grid gap-3 sm:grid-cols-2">
          {milestones.map((m) => (
            <MilestoneCard key={m.title} milestone={m} href={`/docs/progress/#${milestoneId(m.title)}`} />
          ))}
        </div>
      </section>

      {inProgress.length || next.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{inProgress.length ? 'Being built now' : 'Up next'}</h2>
          <ul className="flex flex-col gap-2">
            {(inProgress.length ? inProgress : next).map((i) => (
              <li key={i.milestone + i.name} className="rounded-xl border border-fd-border bg-fd-card p-3 text-sm">
                <p className="text-xs text-fd-muted-foreground">{i.milestone}</p>
                <p className="font-medium">
                  <InlineMd text={i.name} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Latest changes</h2>
          <Link href="/docs/changelog/" className="text-sm underline underline-offset-2">
            Changelog
          </Link>
        </div>
        <LatestChanges />
      </section>
    </main>
  );
}
