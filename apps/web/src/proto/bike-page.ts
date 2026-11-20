import '../styles.css';
import '../ui/present.css';
import '../present/present.css';
import './bike-page.css';
import { mountPresenter, type BikePresenter } from '../present/BikePresenter';
import { shouldDefer3d } from '../scene/helpers';
import { h } from '../ui/dom';
import { openContactSheet } from './contact';
import { BIKES, SHOP, bikeById, formatUsd, type Upgrade } from './data';
import type { Cleanup, ScreenContext } from './main';

export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const bike = bikeById(ctx.params.get('bike') ?? '') ?? BIKES[0];
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  const deferred = ctx.params.get('lite') === '1' || shouldDefer3d({ saveData: nav.connection?.saveData, effectiveType: nav.connection?.effectiveType, deviceMemory: nav.deviceMemory });
  let presenter: BikePresenter | null = null;
  let lastUpgrade: Upgrade | undefined;
  let alive = true;

  const poster = h('div', { class: 'poster' }, h('strong', {}, bike.name), h('span', {}, bike.scene ? 'Loading 3D…' : 'Photo coming soon'));
  const stage = h('div', { class: 'stage-host' });
  const media = h('div', { class: 'media' }, stage, poster);
  const specs = h('section', { class: 'specs', hidden: true });
  const rows = new Map<string, HTMLButtonElement[]>();

  const setActive = (area: string | null) => {
    for (const [a, list] of rows) for (const b of list) (a === area ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current'));
  };
  const row = (area: string, main: string, price: string | null, note: string | undefined, kind: 'component' | 'upgrade', upgrade?: Upgrade) => {
    const b = h('button', { type: 'button', class: 'row', dataset: { area, kind }, onclick: () => {
      lastUpgrade = upgrade;
      setActive(area);
      presenter?.goToArea(area);
    } }, h('span', { class: 'main' }, main), price ? h('span', { class: 'price' }, price) : null, note ? h('small', {}, note) : null);
    rows.set(area, [...(rows.get(area) ?? []), b]);
    return h('li', {}, b);
  };

  const label = poster.querySelector('span')!;
  const loadMs = Number(ctx.params.get('loadms')) || 20_000;
  const mount = () => {
    if (!bike.scene) return;
    poster.querySelector('button')?.remove();
    label.textContent = 'Loading 3D…';
    if (!poster.isConnected) media.append(poster);
    const p = mountPresenter(stage, { scene: bike.scene, header: false, share: false });
    presenter = p;
    let settled = false;
    const fail = () => {
      if (settled || !alive) return;
      settled = true;
      p.destroy();
      presenter = null;
      label.textContent = '3D didn’t load. The rest of the page still works.';
      poster.append(h('button', { type: 'button', class: 'view3d', onclick: mount }, 'Retry'));
    };
    const timer = window.setTimeout(fail, loadMs);
    p.on('areachange', ({ id }) => id && setActive(id));
    p.on('error', fail);
    void p.ready.then(() => {
      clearTimeout(timer);
      if (!alive || settled) return;
      settled = true;
      poster.remove();
      const sp = p.scene?.specs;
      if (sp?.length && !specs.childElementCount) {
        specs.hidden = false;
        specs.append(h('h2', {}, 'Key specs'), h('dl', {}, ...sp.flatMap((r) => [h('dt', {}, r.label), h('dd', {}, r.value)])));
      }
    });
  };
  if (bike.scene && deferred) {
    label.textContent = 'Data saver or slow connection: 3D loads when you tap';
    poster.append(h('button', { type: 'button', class: 'view3d', onclick: mount }, 'View in 3D'));
  } else mount();

  const talk = h('button', { type: 'button', class: 'primary talk', onclick: () => openContactSheet({ bike, upgrade: lastUpgrade }) }, 'Talk to a salesperson');

  host.append(
    h('div', { class: 'p-bike' },
      h('header', { class: 'top' }, h('strong', {}, SHOP.name.toUpperCase())),
      media,
      h('div', { class: 'side' },
        h('div', { class: 'info' },
          h('h1', {}, `${bike.name} · ${bike.year}`),
          bike.priceUsd ? h('p', { class: 'from' }, `from ${formatUsd(bike.priceUsd)}`) : null,
          h('p', { class: 'sizes' }, `Sizes ${bike.sizes} — ask us to find yours`)),
        bike.components.length ? h('section', {}, h('h2', {}, 'Components'), h('ul', {}, ...bike.components.map((c) => row(c.area, c.part, null, c.note, 'component')))) : null,
        bike.upgrades.length
          ? h('section', {}, h('h2', {}, 'Upgrades'), h('ul', {}, ...bike.upgrades.map((u) => row(u.area, `${u.from} → ${u.to}`, `+${formatUsd(u.priceUsd)}`, u.note, 'upgrade', u))))
          : null,
        specs,
        h('div', { class: 'cta' }, talk)),
    ),
  );

  return () => {
    alive = false;
    presenter?.destroy();
  };
}
