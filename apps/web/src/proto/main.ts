import '../styles.css';
import './proto.css';
import { h } from '../ui/dom';

// Phase 0 clickable prototype (docs/PRODUCT-VIEWS.md §8): one page, a tab per screen, hash routing, made-up data.
// Each screen module owns its file and its CSS class; render() returns an optional cleanup.

export type Cleanup = void | (() => void);
export interface ScreenContext { navigate: (hash: string) => void; params: URLSearchParams }
type Screen = { id: string; label: string; load: () => Promise<{ render: (host: HTMLElement, ctx: ScreenContext) => Cleanup }> };

const SCREENS: Screen[] = [
  { id: 'studio', label: 'Studio', load: () => import('./studio') },
  { id: 'workspace', label: 'Bike workspace', load: () => import('./workspace') },
  { id: 'bike', label: 'Bike page', load: () => import('./bike-page') },
  { id: 'show', label: 'Show customer', load: () => import('./show-customer') },
  { id: 'storefront', label: 'Storefront', load: () => import('./storefront') },
  { id: 'contact', label: 'Talk to a salesperson', load: () => import('./contact') },
];

const root = document.getElementById('proto')!;
const tabs = h('nav', { class: 'proto-tabs', 'aria-label': 'Prototype screens' });
const view = h('main', { class: 'proto-view' });
root.append(tabs, view);
let cleanup: Cleanup;

function parseHash(): { id: string; params: URLSearchParams } {
  const [id, query = ''] = location.hash.slice(1).split('?');
  return { id: SCREENS.some((s) => s.id === id) ? id : 'studio', params: new URLSearchParams(query) };
}

async function show(): Promise<void> {
  const { id, params } = parseHash();
  tabs.replaceChildren(
    ...SCREENS.map((s) => h('a', { href: `#${s.id}`, 'aria-current': s.id === id ? 'page' : undefined }, s.label)),
    h('span', { class: 'proto-note' }, 'Prototype · made-up data'),
  );
  if (typeof cleanup === 'function') cleanup();
  view.replaceChildren();
  view.dataset.screen = id;
  const mod = await SCREENS.find((s) => s.id === id)!.load();
  cleanup = mod.render(view, { navigate: (hash) => (location.hash = hash), params });
}

window.addEventListener('hashchange', () => void show());
void show();
