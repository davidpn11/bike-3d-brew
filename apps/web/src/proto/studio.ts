import { h } from '../ui/dom';
import { BIKES, MESSAGES, bikeById, formatUsd } from './data';
import './studio.css';
import type { Cleanup, ScreenContext } from './main';

const label = (s: string) => s[0].toUpperCase() + s.slice(1);
const stateLabel = (s: string) => s === 'unavailable' ? 'Unavailable' : label(s);

export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const root = h('section', { class: 'p-studio' });
  host.append(root);
  let tab = ctx.params.get('tab') === 'messages' ? 'messages' : 'library';
  let search = '';
  let state = 'all', type = 'all', brand = 'all', layout = 'grid';
  const statuses = new Map(MESSAGES.map((m) => [m.id, m.status]));
  const select = (aria: string, values: string[], value: string, change: (v: string) => void) => h('label', {}, aria, h('select', { 'aria-label': aria, value, onchange: (e: Event) => change((e.target as HTMLSelectElement).value) }, ...values.map((v) => h('option', { value: v }, v === 'all' ? 'All' : label(v)))));
  const renderPage = () => {
    const filtered = BIKES.filter((b) => (!search || `${b.name} ${b.brand}`.toLowerCase().includes(search.toLowerCase())) && (state === 'all' || b.state === state) && (type === 'all' || b.type === type) && (brand === 'all' || b.brand === brand));
    const attention = BIKES.filter((b) => b.state === 'draft' && b.readiness.some((r) => !r.done)).length;
    const unanswered = [...statuses.values()].filter((s) => s === 'new').length;
    const messages = h('div', { class: 'p-studio-messages' }, ...MESSAGES.map((m) => {
      const bike = bikeById(m.bikeId)!;
      const age = Math.max(0, Math.floor((Date.now() - new Date(m.receivedAt).getTime()) / 3600000));
      const status = h('select', { 'aria-label': `Status for ${m.name}`, value: statuses.get(m.id), onchange: (e: Event) => statuses.set(m.id, (e.target as HTMLSelectElement).value as typeof m.status) }, ...['new', 'replied', 'test ride booked', 'closed'].map((v) => h('option', { value: v }, label(v))));
      return h('article', { class: 'p-message' }, h('div', { class: 'p-message-top' }, h('strong', {}, m.name), h('span', {}, `${age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`}`)), h('p', {}, `${bike.name} · ${m.text}`), h('div', { class: 'p-chips' }, ...m.topics.map((t) => h('span', {}, t))), h('div', { class: 'p-message-meta' }, h('span', {}, `${m.replyBy === 'email' ? `✉ ${m.contact}` : `▣ ${m.contact}`} · ${m.source}`), status));
    }));
    root.replaceChildren(
      h('header', { class: 'p-studio-head' }, h('div', {}, h('p', { class: 'p-eyebrow' }, 'Brew Cycles'), h('h1', {}, 'Studio')), h('button', { type: 'button', class: 'p-primary', onclick: () => ctx.navigate('#workspace?bike=aero-r1') }, '+ Add bike')),
      h('nav', { class: 'p-studio-subnav', 'aria-label': 'Studio sections' }, h('button', { class: tab === 'library' ? 'active' : '', onclick: () => { tab = 'library'; ctx.navigate('#studio'); } }, 'Bikes'), h('button', { class: tab === 'messages' ? 'active' : '', onclick: () => { tab = 'messages'; ctx.navigate('#studio?tab=messages'); } }, `Messages ${MESSAGES.length}`), h('span', {}, 'Storefront'), h('span', {}, 'Settings')),
      tab === 'messages' ? h('div', { class: 'p-studio-content' }, h('h2', {}, 'Messages'), MESSAGES.length ? messages : h('p', { class: 'p-empty' }, 'No messages yet.')) : h('div', { class: 'p-studio-content' },
        h('div', { class: 'p-filters' }, h('label', {}, 'Search', h('input', { type: 'search', placeholder: 'Search bikes…', value: search, oninput: (e: Event) => { search = (e.target as HTMLInputElement).value; renderPage(); } })), select('State', ['all', 'draft', 'live', 'unavailable', 'archived'], state, (v) => { state = v; renderPage(); }), select('Type', ['all', ...new Set(BIKES.map((b) => b.type))], type, (v) => { type = v; renderPage(); }), select('Brand', ['all', ...new Set(BIKES.map((b) => b.brand))], brand, (v) => { brand = v; renderPage(); }), h('div', { class: 'p-layout-switch', role: 'group', 'aria-label': 'Layout' }, h('button', { 'aria-pressed': layout === 'grid', onclick: () => { layout = 'grid'; renderPage(); } }, '▦ Grid'), h('button', { 'aria-pressed': layout === 'list', onclick: () => { layout = 'list'; renderPage(); } }, '☰ List'))),
        h('p', { class: 'p-attention' }, `Needs attention: ${attention} draft${attention === 1 ? '' : 's'} missing details · ${unanswered} message${unanswered === 1 ? '' : 's'} unanswered`),
        filtered.length ? h('div', { class: `p-bike-grid ${layout === 'list' ? 'is-list' : ''}` }, ...filtered.map((b) => h('button', { type: 'button', class: 'p-bike-card', onclick: () => ctx.navigate(`#workspace?bike=${b.id}`) }, h('span', { class: `p-bike-art ${b.has3d ? 'has-3d' : ''}` }, b.has3d ? '↻ 3D' : '▧ Photos'), h('span', { class: 'p-bike-name' }, b.name), h('span', { class: 'p-bike-price' }, b.priceUsd === null ? 'Price hidden' : formatUsd(b.priceUsd)), h('span', { class: `p-state ${b.state}` }, stateLabel(b.state)), h('span', { class: 'p-bike-metric' }, b.state === 'live' ? `${b.views} views` : b.state === 'draft' ? `${b.readiness.filter((x) => x.done).length}/${b.readiness.length} ready` : b.state === 'unavailable' ? 'Ask about availability' : 'Archived')))) : h('p', { class: 'p-empty' }, 'No bikes match these filters.')),
    );
  };
  renderPage();
  return () => root.remove();
}
