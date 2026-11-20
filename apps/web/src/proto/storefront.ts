import { h } from '../ui/dom';
import { BIKES, SHOP, formatUsd } from './data';
import './storefront.css';
import type { Cleanup, ScreenContext } from './main';

export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const root = h('section', { class: 'p-storefront' });
  let type = 'all', brand = 'all', size = 'all', price = 'all';
  const paint = () => {
    const shown = BIKES.filter((b) => ['live', 'unavailable'].includes(b.state) && (type === 'all' || b.type === type) && (brand === 'all' || b.brand === brand) && (size === 'all' || b.sizes.includes(size)) && (price === 'all' || (b.priceUsd !== null && (price === 'under-2500' ? b.priceUsd < 2500 : b.priceUsd >= 2500))));
    const filter = (name: string, values: string[], value: string, set: (v: string) => void) => h('label', {}, name, h('select', { 'aria-label': name, value, onchange: (e: Event) => { set((e.target as HTMLSelectElement).value); paint(); } }, ...values.map((v) => h('option', { value: v }, v === 'all' ? 'All' : v === 'under-2500' ? 'Under $2,500' : v === 'over-2500' ? '$2,500 and up' : v))));
    root.replaceChildren(h('header', { class: 'p-s-header' }, h('p', { class: 'p-s-eyebrow' }, 'The Brew Cycles showroom'), h('h1', {}, SHOP.name), h('p', {}, SHOP.city)), h('main', { class: 'p-s-content' }, h('h2', {}, 'New bikes'), h('div', { class: 'p-s-filters' }, filter('Type', ['all', ...new Set(BIKES.map((b) => b.type))], type, (v) => type = v), filter('Brand', ['all', ...new Set(BIKES.map((b) => b.brand))], brand, (v) => brand = v), filter('Size', ['all', ...new Set(BIKES.flatMap((b) => b.sizes.split(/[–, ]+/).filter((x) => x && x.length <= 3)))], size, (v) => size = v), filter('Price', ['all', 'under-2500', 'over-2500'], price, (v) => price = v)), shown.length ? h('div', { class: 'p-s-grid' }, ...shown.map((b) => h('button', { class: 'p-s-card', onclick: () => ctx.navigate(`#bike?bike=${b.id}`) }, h('span', { class: 'p-s-art' }, b.has3d ? '↻ 3D' : '▧ Photos'), h('span', { class: 'p-s-name' }, b.name), h('span', { class: 'p-s-brand' }, `${b.brand} · ${b.year} · ${b.type}`), h('span', { class: 'p-s-price' }, b.priceUsd === null ? 'Ask for pricing' : formatUsd(b.priceUsd)), b.state === 'unavailable' ? h('span', { class: 'p-s-unavailable' }, 'Ask about availability') : null))) : h('p', { class: 'p-s-empty' }, 'No bikes match these filters.')));
  };
  host.append(root);
  paint();
  return () => root.remove();
}
