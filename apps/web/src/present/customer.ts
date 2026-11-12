import '../styles.css';
import '../ui/present.css';
import './present.css';
import { parseArea } from '../scene/embed';
import { readViewParams } from '../scene/share';
import { mountPresenter } from './BikePresenter';

// The customer link, `?scene=…&view=present[&area=…]`: the presenter, full page, nothing else.
// embed.html runs the same page plus the postMessage bridge (embed.ts).

const params = new URLSearchParams(location.search);
const view = readViewParams(location.search);
document.getElementById('app')?.remove();
const host = document.createElement('div');
host.className = 'present-host';
document.body.append(host);
document.body.dataset.mode = 'present';
document.body.dataset.readonly = 'true';

export const presenter = mountPresenter(host, {
  // A bare `?view=present` shows the published demo.
  scene: view.scene ?? 'scenes/demo/scene.bike.json',
  kiosk: { interval: view.interval, idle: view.idle, autoplay: view.kiosk },
  // Framed (embed.html), focus stays with the shop's page until the customer clicks the bike.
  autofocus: window.top === window,
  area: parseArea(params.get('area')),
});

// Same test hook shape as main.ts (docs/TESTING.md), read-only: `store.scene` is the shown scene.
if (import.meta.env.DEV || params.has('e2e')) {
  const hook = { app: presenter, presenter, viewer: presenter.viewer, pivotAt: (x: number, y: number) => presenter.viewer.pivotAt(x, y), store: { get scene() { return presenter.scene; } }, ready: false };
  (window as unknown as { __bike: typeof hook }).__bike = hook;
  void presenter.ready.then(() => (hook.ready = true));
}
