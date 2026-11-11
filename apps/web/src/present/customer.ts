import '../styles.css';
import { readViewParams } from '../scene/share';
import { mountPresenter } from './BikePresenter';

// The customer link, `?scene=…&view=present`: the presenter, full page, nothing else.

const params = new URLSearchParams(location.search);
const view = readViewParams(location.search);
document.getElementById('app')?.remove();
const host = document.createElement('div');
host.className = 'present-host';
document.body.append(host);
document.body.dataset.mode = 'present';
document.body.dataset.readonly = 'true';

const presenter = mountPresenter(host, {
  // A bare `?view=present` shows the published demo.
  scene: view.scene ?? 'scenes/demo/scene.bike.json',
  kiosk: { interval: view.interval, idle: view.idle, autoplay: view.kiosk },
  autofocus: true,
});

// Same test hook shape as main.ts (docs/TESTING.md), read-only: `store.scene` is the shown scene.
if (import.meta.env.DEV || params.has('e2e')) {
  const hook = { app: presenter, presenter, viewer: presenter.viewer, store: { get scene() { return presenter.scene; } }, ready: false };
  (window as unknown as { __bike: typeof hook }).__bike = hook;
  void presenter.ready.then(() => (hook.ready = true));
}
