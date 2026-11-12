import '../styles.css';
import '../ui/present.css';
import '../present/present.css';
import './show-customer.css';
import { mountPresenter, type BikePresenter } from '../present/BikePresenter';
import { h } from '../ui/dom';
import { openContactSheet } from './contact';
import { BIKES, SHOP, bikeById, formatUsd, type ProtoBike } from './data';
import type { Cleanup, ScreenContext } from './main';

// Area names are not in data.ts; they mirror the demo scene's hotspots (public/scenes/demo/scene.bike.json), in its Present order.
const AREAS: { id: string | null; name: string }[] = [
  { id: null, name: 'Overview' },
  { id: 'hs-fork', name: 'Fork' },
  { id: 'hs-drivetrain', name: 'Drivetrain' },
  { id: 'hs-cockpit', name: 'Cockpit' },
  { id: 'hs-saddle', name: 'Saddle' },
  { id: 'hs-front-wheel', name: 'Wheels' },
  { id: 'hs-frame', name: 'Frame' },
];

const placeholder = (bike: ProtoBike) => h('div', { class: 'ph' }, h('strong', {}, bike.name), h('span', {}, 'Photo placeholder: no 3D capture yet'));

/** Mounts a presenter (or a placeholder) into `box`; the presenter's own card is hidden by CSS, the screen draws its own. */
function mountBike(box: HTMLElement, bike: ProtoBike, autoplay = false): BikePresenter | null {
  if (!bike.scene) {
    box.append(placeholder(bike));
    return null;
  }
  return mountPresenter(box, { scene: bike.scene, header: false, share: false, kiosk: { autoplay } });
}

export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  return ctx.params.get('window') === '1' ? windowMode(host, ctx) : showMode(host);
}

function showMode(host: HTMLElement): Cleanup {
  const left = bikeById('aero-r1')!;
  const right = bikeById('endurance-cf7')!;
  let index = 0;
  let compare = false;
  let qr = false;
  const presenters: BikePresenter[] = [];

  const root = h('div', { class: 'p-show' });
  const bar = h('header', { class: 'bar' });
  const body = h('div', { class: 'body' });
  const areaBar = h('nav', { class: 'areas', 'aria-label': 'Areas' });
  const qrBox = h('aside', { class: 'qr', hidden: true });
  root.append(bar, body, qrBox, areaBar, h('p', { class: 'hint' }, 'Best on a tablet in landscape.'));
  host.append(root);

  const go = (i: number) => {
    index = (i + AREAS.length) % AREAS.length;
    update();
    for (const p of presenters.slice(0, 1)) void p.ready.then(() => p.goToArea(AREAS[index].id));
  };
  const card = (bike: ProtoBike, isLeft: boolean) => {
    const area = AREAS[index];
    const comp = bike.components.find((c) => c.area === area.id);
    const up = bike.upgrades.find((u) => u.area === area.id);
    return h('div', { class: 'card' },
      h('button', { type: 'button', class: 'step prev', 'aria-label': 'Previous area', onclick: () => go(index - 1) }, '◀'),
      h('div', { class: 'text', 'aria-live': isLeft ? 'polite' : 'off' },
        area.id === null
          ? h('p', {}, h('strong', {}, `${bike.name} `), bike.priceUsd ? `from ${formatUsd(bike.priceUsd)} · ` : '', `Sizes ${bike.sizes}`)
          : h('p', {}, h('strong', {}, `${area.name}: `), comp ? `${comp.part}. ${comp.note}` : 'Nothing noted for this area yet.'),
        up ? h('p', { class: 'up' }, `Upgrade: ${up.to} +${formatUsd(up.priceUsd)}`) : null),
      h('button', { type: 'button', class: 'step next', 'aria-label': 'Next area', onclick: () => go(index + 1) }, '▶'));
  };

  const reset = () => {
    index = 0;
    compare = false;
    qr = false;
    build();
  };

  function update() {
    areaBar.replaceChildren(...AREAS.map((a, i) => h('button', { type: 'button', class: 'area', 'aria-current': i === index ? 'true' : undefined, onclick: () => go(i) }, a.name)));
    qrBox.hidden = !qr;
    root.dataset.compare = String(compare);
    const cards = body.querySelectorAll('.panel .card');
    [left, right].slice(0, cards.length).forEach((b, i) => cards[i].replaceWith(card(b, i === 0)));
    bar.replaceChildren(
      h('strong', {}, `${SHOP.name} · Showing`),
      h('div', { class: 'tools' },
        h('button', { type: 'button', 'aria-pressed': String(compare), onclick: () => { compare = !compare; build(); } }, 'Compare ⇆'),
        h('button', { type: 'button', 'aria-pressed': String(qr), onclick: () => { qr = !qr; update(); } }, 'QR ▣'),
        h('button', { type: 'button', class: 'done', onclick: reset }, 'Done ↺')),
    );
  }

  function build() {
    for (const p of presenters.splice(0)) p.destroy();
    body.replaceChildren();
    const panel = (bike: ProtoBike, isLeft: boolean) => {
      const box = h('div', { class: 'view' });
      const p = isLeft ? mountBike(box, bike) : (box.append(placeholder(bike)), null);
      if (p) presenters.push(p);
      return h('section', { class: 'panel', 'aria-label': bike.name }, h('h2', {}, bike.name, bike.priceUsd ? ` ${formatUsd(bike.priceUsd)}` : ''), box, card(bike, isLeft),
        isLeft ? null : h('p', { class: 'hint' }, 'Camera sync comes with real captures.'));
    };
    body.append(panel(left, true), ...(compare ? [panel(right, false)] : []));
    qrBox.replaceChildren(
      h('div', { class: 'code', role: 'img', 'aria-label': 'QR code placeholder' }),
      h('p', {}, 'Scan to open this bike on your phone'),
      h('code', {}, `${location.origin}${location.pathname}#bike?bike=${left.id}`),
    );
    update();
    go(index);
  }

  const contactBtn = h('button', { type: 'button', class: 'ask', onclick: () => openContactSheet({ bike: left }) }, 'Ask a salesperson');
  root.append(contactBtn);
  build();
  return () => presenters.splice(0).forEach((p) => p.destroy());
}

/** Window mode: a loop over the live bikes. The PIN lock is only described; nothing is enforced in the prototype. */
function windowMode(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const live = BIKES.filter((b) => b.state === 'live');
  const ms = Number(ctx.params.get('ms')) || 8000;
  let i = 0;
  let presenter: BikePresenter | null = null;
  const slide = h('div', { class: 'slide' });
  host.append(h('div', { class: 'p-show window', dataset: { window: '1' } }, slide, h('footer', { class: 'hint' }, 'Window mode: a locked loop of live bikes. Leaving needs a PIN (not enforced in this prototype).')));
  const show = () => {
    presenter?.destroy();
    const bike = live[i % live.length];
    const box = h('div', { class: 'view' });
    presenter = mountBike(box, bike, true);
    slide.replaceChildren(h('h2', { class: 'big' }, bike.name, bike.priceUsd ? ` ${formatUsd(bike.priceUsd)}` : ''), box, h('p', { class: 'big-sub' }, `${SHOP.name} · Ask inside`));
    slide.dataset.bike = bike.id;
    i++;
  };
  show();
  const t = window.setInterval(show, ms);
  return () => { clearInterval(t); presenter?.destroy(); };
}
