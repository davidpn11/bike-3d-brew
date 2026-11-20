import base from '../styles.css?inline';
import card from '../ui/present.css?inline';
import own from './present.css?inline';
import theme from '../themes/bikebrew.css?inline';
import { parseArea } from '../scene/embed';
import { type BikePresenter, type PresenterEvents, mountPresenter } from './BikePresenter';

// `<bike-viewer src="…/scene.bike.json" area="hs-fork" kiosk>`: the customer view as a custom
// element for a shop's own page. Everything renders in a shadow root with its own copy of the CSS,
// so the page's styles do not reach the bike and ours never reach the page. Presenter events are
// re-dispatched on the element (`ready`, `error`, `areachange`, `commentopen`); `presenter` is the
// controller API (goToArea, next, prev, play, pause, setBackground, openComment).

const CSS = `${base}\n${card}\n${own}\n${theme}\n:host { display: block; position: relative; height: 480px; contain: content; }`;
const EVENTS: (keyof PresenterEvents)[] = ['ready', 'error', 'areachange', 'commentopen'];

export class BikeViewerElement extends HTMLElement {
  static observedAttributes = ['src', 'area', 'kiosk'];
  presenter: BikePresenter | null = null;
  private shadow = this.attachShadow({ mode: 'open' });

  constructor() {
    super();
    this.shadow.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.presenter?.destroy();
    this.presenter = null;
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    const p = this.presenter;
    if (!p || old === value) return;
    // Before the scene is shown, mount() has not used the new value yet.
    if (name === 'src' || !p.scene) this.mount();
    else if (name === 'area') p.goToArea(parseArea(value) ?? 0);
    else if (value === null) p.pause();
    else p.play();
  }

  private mount(): void {
    this.presenter?.destroy();
    this.presenter = null;
    const src = this.getAttribute('src');
    // shortcut: no src renders nothing; a placeholder could come with a "pick a bike" flow.
    if (!src) return;
    // Share is off: it would link the shop's page with our query string, which that page cannot read.
    const p = mountPresenter(this.shadow, { scene: src, share: false, area: parseArea(this.getAttribute('area')), kiosk: { autoplay: this.hasAttribute('kiosk') } });
    for (const name of EVENTS) p.on(name, (detail) => this.dispatchEvent(new CustomEvent(name, { detail })));
    this.presenter = p;
  }
}

if (!customElements.get('bike-viewer')) customElements.define('bike-viewer', BikeViewerElement);
