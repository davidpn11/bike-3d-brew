import '../styles.css';
import '../ui/present.css';
import '../present/present.css';
import './bike-page.css';
import { mountPresenter, type BikePresenter } from '../present/BikePresenter';
import { h } from '../ui/dom';
import { openContactSheet } from './contact';
import { BIKES, SHOP, bikeById, formatUsd, type Upgrade } from './data';
import type { Cleanup, ScreenContext } from './main';

export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const bike = bikeById(ctx.params.get('bike') ?? '') ?? BIKES[0];
  const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
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

  const mount = () => {
    if (!bike.scene) return;
    const p = mountPresenter(stage, { scene: bike.scene, header: false, share: false });
    presenter = p;
    p.on('areachange', ({ id }) => id && setActive(id));
    void p.ready.then(() => {
      if (!alive) return;
      poster.remove();
      const s = p.scene?.specs;
      if (s?.length) {
        specs.hidden = false;
        specs.append(h('h2', {}, 'Key specs'), h('dl', {}, ...s.flatMap((r) => [h('dt', {}, r.label), h('dd', {}, r.value)])));
      }
    });
  };
  if (bike.scene && saveData) {
    const label = poster.querySelector('span')!;
    label.textContent = 'Data saver is on: 3D loads when you tap';
    poster.append(h('button', { type: 'button', class: 'view3d', onclick: (e: Event) => { (e.currentTarget as HTMLElement).remove(); label.textContent = 'Loading 3D…'; mount(); } }, 'View in 3D'));
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
