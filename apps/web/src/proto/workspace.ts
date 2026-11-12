import { h } from '../ui/dom';
import { bikeById, formatUsd } from './data';
import { mountPresenter } from '../present/BikePresenter';
import '../ui/present.css';
import '../present/present.css';
import './workspace.css';
import type { Cleanup, ScreenContext } from './main';

export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const bike = bikeById(ctx.params.get('bike') ?? 'aero-r1') ?? bikeById('aero-r1')!;
  let published = bike.state === 'live';
  let tab = 'Details';
  let kind = 'Component';
  const components = bike.components.map((x) => ({ ...x }));
  const upgrades = bike.upgrades.map((x) => ({ ...x }));
  const root = h('section', { class: 'p-workspace' });
  let presenter: ReturnType<typeof mountPresenter> | undefined;
  let toastTimer = 0;
  const notify = (text: string) => { const el = root.querySelector<HTMLElement>('.p-w-toast')!; el.textContent = text; el.hidden = false; window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { el.hidden = true; }, 2600); };
  const paint = () => {
    presenter?.destroy();
    presenter = undefined;
    const stage = h('div', { class: 'p-w-stage-wrap' }, bike.scene ? h('div', { class: 'p-w-presenter' }) : h('div', { class: 'p-w-placeholder' }, h('span', {}, '▧'), h('strong', {}, 'Photos only'), h('span', {}, 'Add a 3D capture later')));
    const rows = tab === 'Components' ? components.map((c, i) => h('div', { class: 'p-w-row' }, h('div', {}, h('strong', {}, c.part), h('small', {}, c.note)), h('button', { 'aria-label': `Remove ${c.part}`, onclick: () => { components.splice(i, 1); paint(); } }, '×'))) : tab === 'Upgrades' ? upgrades.map((u, i) => h('div', { class: 'p-w-row' }, h('div', {}, h('strong', {}, `${u.from} → ${u.to}`), h('small', {}, `${formatUsd(u.priceUsd)} · ${u.note ?? 'Upgrade option'}`)), h('button', { 'aria-label': `Remove ${u.to}`, onclick: () => { upgrades.splice(i, 1); paint(); } }, '×'))) : [];
    const details = tab === 'Details' ? h('div', { class: 'p-w-summary' }, h('p', {}, `${bike.brand} · ${bike.year} · ${bike.type}`), h('p', {}, `Sizes ${bike.sizes}`), h('p', {}, bike.priceUsd === null ? 'Price hidden' : formatUsd(bike.priceUsd))) : tab === 'Components' || tab === 'Upgrades' ? h('div', { class: 'p-w-list' }, ...(rows.length ? rows : [h('p', { class: 'p-w-empty' }, tab === 'Components' ? 'No components added yet.' : 'No upgrades added yet.')]), h('button', { class: 'p-w-add', onclick: () => {
      if (tab === 'Components') components.push({ area: 'hs-frame', part: 'New component', note: 'Add a customer-friendly description.' });
      else upgrades.push({ area: 'hs-frame', from: 'Stock part', to: 'Upgrade part', priceUsd: 0, note: 'Ask about fitting time.' });
      paint();
    } }, '+ Add row')) : h('p', { class: 'p-w-summary' }, 'Specifications are included in the bike listing.');
    root.replaceChildren(h('header', { class: 'p-w-header' }, h('button', { class: 'p-w-back', onclick: () => ctx.navigate('#studio') }, '← Bikes'), h('div', { class: 'p-w-title' }, h('h1', {}, bike.name), h('span', { class: `p-state ${published ? 'live' : 'draft'}` }, published ? 'Live' : 'Draft'), h('small', {}, 'Saved')), h('div', { class: 'p-w-actions' }, h('button', { onclick: () => ctx.navigate(`#bike?bike=${bike.id}`) }, 'Preview as customer'), h('button', { class: 'p-primary', onclick: () => { published = true; paint(); notify(`${bike.name} published`); } }, published ? 'Publish update' : 'Publish'))),
      h('div', { class: 'p-w-layout' }, h('section', { class: 'p-w-main' }, h('div', { class: 'p-w-pin-toggle', role: 'group', 'aria-label': 'Next pin kind' }, h('button', { class: kind === 'Component' ? 'selected' : '', 'aria-pressed': kind === 'Component', onclick: () => { kind = 'Component'; paint(); } }, 'Component ●'), h('button', { class: kind === 'Upgrade' ? 'selected' : '', 'aria-pressed': kind === 'Upgrade', onclick: () => { kind = 'Upgrade'; paint(); } }, 'Upgrade ▲')), stage, h('p', { class: 'p-w-next' }, `Next tap adds: ${kind}`)),
        h('aside', { class: 'p-w-panel' }, h('h2', {}, `Ready to publish  ${bike.readiness.filter((r) => r.done).length}/${bike.readiness.length}`), h('ul', { class: 'p-w-checklist' }, ...bike.readiness.map((r) => h('li', { class: r.done ? 'done' : 'todo' }, `${r.done ? '✓' : '○'} ${r.label}`))), h('div', { class: 'p-w-tabs', role: 'tablist' }, ...['Details', 'Components', 'Upgrades', 'Specs'].map((t) => h('button', { role: 'tab', 'aria-selected': tab === t, class: tab === t ? 'active' : '', onclick: () => { tab = t; paint(); } }, t))), details)), h('div', { class: 'p-w-toast', role: 'status', hidden: true }));
    if (bike.scene) {
      const presenterHost = root.querySelector<HTMLElement>('.p-w-presenter')!;
      presenter = mountPresenter(presenterHost, { scene: bike.scene, header: false, share: false });
      const mountedPresenter = presenter;
      void mountedPresenter.ready.then(() => {
        if (presenter === mountedPresenter) presenterHost.dataset.presenterReady = 'true';
      });
    }
  };
  host.append(root);
  paint();
  return () => { window.clearTimeout(toastTimer); presenter?.destroy(); root.remove(); };
}
