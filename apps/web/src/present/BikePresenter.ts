import { viewForPoint } from '../scene/camera';
import { distance, presentLede, wrapStep } from '../scene/helpers';
import { KIOSK_DEFAULTS } from '../scene/kiosk';
import type { BackgroundMode, BikeScene, Hotspot } from '../scene/schema';
import { ShareError, loadPublishedScene, publishedPhotoUrls, shareLink } from '../scene/share';
import { h } from '../ui/dom';
import { type PhotoSource, Lightbox, filmstrip } from '../ui/photoViewer';
import { PresentView } from '../ui/present';
import { centerOnGround, loadModel } from '../viewer/loaders';
import { PinLayer } from '../viewer/pins';
import { Viewer } from '../viewer/Viewer';
import './present.css';

// The customer experience (read-only Present mode) as a self-contained module: give it a container
// and a scene (or a scene URL) and it renders the bike, the pins, the Present card, leader lines,
// close-ups and auto-play inside that container. It imports no editing code (comment editor, file
// drop, capture import/cache, HEIC decoding), sizes itself from the container, scopes its CSS under
// `.bike-present` and only listens to keys while focused, so it can be mounted by main.ts for
// `?view=present`, inside an iframe page, or by a `<bike-viewer>` custom element.

export interface PresenterOptions {
  /** A scene object, or the URL of a published `scene.bike.json` (same origin or https). */
  scene: BikeScene | string;
  /** Resolves relative scene URLs and is the base of share links (default: location.href). */
  pageHref?: string;
  /** Show the name/price bar with a Share button (default true). */
  header?: boolean;
  /** Show the Share button in the bar (default true). */
  share?: boolean;
  /** Overrides the scene's background. */
  background?: BackgroundMode;
  /** Auto-advance timing in ms; `autoplay` starts it once the model is shown. */
  kiosk?: { interval?: number; idle?: number; autoplay?: boolean };
  /** Focus the presenter after mounting, so arrow keys work right away (default false). */
  autofocus?: boolean;
}

export interface PresenterEvents {
  ready: { scene: BikeScene };
  error: { message: string };
  areachange: { index: number; id: string | null; name: string };
  commentopen: { id: string; title: string };
}
type Listener<K extends keyof PresenterEvents> = (detail: PresenterEvents[K]) => void;

/** Published close-ups are plain URLs: nothing to decode or cache. */
const URL_PHOTOS: PhotoSource = { errors: new Map(), get: (path) => Promise.resolve(path) };

export class BikePresenter {
  readonly root: HTMLDivElement;
  readonly viewer: Viewer;
  scene: BikeScene | null = null;
  /** Where the scene came from (resolved), when it was loaded by URL. */
  sceneHref: string | null = null;
  /** Resolves after the scene and model are shown (or an error was displayed); never rejects. */
  readonly ready: Promise<void>;
  private stage: HTMLDivElement;
  private header: HTMLElement;
  private toastEl: HTMLDivElement;
  private pins: PinLayer;
  private present: PresentView;
  private lightbox: Lightbox;
  private step = 0;
  private active: string | null = null;
  private listeners = new Map<keyof PresenterEvents, Set<(d: never) => void>>();
  private pageHref: string;

  constructor(
    container: HTMLElement,
    private opts: PresenterOptions,
  ) {
    this.pageHref = opts.pageHref ?? location.href;
    this.header = h('header', { class: 'bp-bar' });
    const viewport = h('div', { class: 'viewport' });
    this.stage = h('div', { class: 'stage' }, viewport);
    this.toastEl = h('div', { class: 'toast', role: 'status', hidden: true });
    this.root = h('div', { class: 'bike-present', tabindex: 0, 'aria-label': 'Bike presentation', onkeydown: (e: KeyboardEvent) => this.onKey(e) }, opts.header === false ? null : this.header, this.stage);
    container.append(this.root);
    this.viewer = new Viewer(viewport);
    this.pins = new PinLayer(this.viewer, this.stage, (id) => this.openComment(id));
    this.stage.append(this.toastEl);
    this.present = new PresentView(this.viewer, this.stage, { go: (s) => this.goToArea(s), focus: (id) => this.openComment(id) }, { ...KIOSK_DEFAULTS, ...pick(opts.kiosk) });
    this.lightbox = new Lightbox(this.root);
    if (opts.autofocus) this.root.focus({ preventScroll: true });
    this.ready = this.load();
  }

  // ---------------------------------------------------------------- controller API

  on<K extends keyof PresenterEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (d: never) => void);
    return () => set!.delete(fn as (d: never) => void);
  }

  /** The areas in Present order: index 0 is the whole bike. */
  get areas(): { id: string | null; name: string }[] {
    return this.steps().map((s) => ({ id: s?.id ?? null, name: s?.name ?? this.scene?.name ?? '' }));
  }

  get areaIndex(): number {
    return this.step;
  }

  /** Flies to an area by index (wrapping) or hotspot id; `null` is the whole bike. */
  goToArea(target: number | string | null): void {
    const steps = this.steps();
    const index = typeof target === 'number' ? wrapStep(target, steps.length) : Math.max(0, steps.findIndex((s) => (s?.id ?? null) === target));
    this.step = index;
    this.active = null;
    this.present.kiosk.restart();
    const hotspot = steps[index];
    this.render();
    if (this.scene) void this.viewer.flyTo(hotspot ? hotspot.view : this.viewer.overviewView());
    this.emit('areachange', { index, id: hotspot?.id ?? null, name: hotspot?.name ?? this.scene?.name ?? '' });
  }

  next(): void {
    this.goToArea(this.step + 1);
  }

  prev(): void {
    this.goToArea(this.step - 1);
  }

  play(): void {
    this.present.kiosk.play();
  }

  pause(): void {
    this.present.kiosk.stop();
  }

  get playing(): boolean {
    return this.present.kiosk.state !== 'off';
  }

  setBackground(mode: BackgroundMode): void {
    this.viewer.setBackground(mode);
  }

  /** Opens a comment: highlights it and flies the camera to its pin. */
  openComment(id: string): void {
    const a = this.scene?.annotations.find((x) => x.id === id);
    if (!a) return;
    const step = this.steps().findIndex((s) => s?.id === a.hotspotId);
    if (step >= 0) this.step = step;
    this.active = id;
    this.render();
    const hotspot = this.scene!.hotspots.find((x) => x.id === a.hotspotId);
    const radius = hotspot ? distance(hotspot.view.position, hotspot.view.target) * 0.75 : 0.6;
    void this.viewer.flyTo(viewForPoint(a.position, a.normal, this.viewer.getView().position, Math.max(0.25, radius)));
    this.emit('commentopen', { id, title: a.title });
  }

  destroy(): void {
    this.present.hide();
    this.viewer.dispose();
    this.root.remove();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- internals

  private async load(): Promise<void> {
    try {
      let scene: BikeScene;
      if (typeof this.opts.scene === 'string') {
        const loaded = await loadPublishedScene(this.opts.scene, this.pageHref);
        scene = loaded.scene;
        this.sceneHref = loaded.href;
      } else scene = this.opts.scene;
      this.scene = scene;
      this.viewer.setBackground(this.opts.background ?? scene.background);
      this.renderHeader();
      this.toast('Loading model…');
      const url = scene.model.format === 'demo' ? scene.model.url : new URL(scene.model.url, this.sceneHref ?? this.pageHref).href;
      this.viewer.setModel(centerOnGround(await loadModel(url, scene.model.format)), scene.model);
      this.toast('');
      this.viewer.setView(this.viewer.overviewView());
      this.goToArea(0);
      if (this.opts.kiosk?.autoplay) this.play();
      this.emit('ready', { scene });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.toast('');
      this.root.append(
        h('div', { class: 'link-error', role: 'alert' }, h('strong', {}, 'This bike can’t be shown right now'), h('p', {}, message), h('p', { class: 'hint' }, err instanceof ShareError ? 'Ask the shop for a new link.' : 'Check your connection and reload.')),
      );
      this.emit('error', { message });
    }
  }

  private steps(): (Hotspot | null)[] {
    return [null, ...(this.scene?.hotspots ?? [])];
  }

  private render(): void {
    const scene = this.scene;
    if (!scene) return;
    const hotspot = this.steps()[this.step];
    const notes = hotspot ? scene.annotations.filter((a) => a.hotspotId === hotspot.id) : [];
    this.pins.setAnnotations(scene.annotations);
    this.pins.filter(hotspot ? notes.map((a) => a.id) : null);
    this.pins.setActive(this.active);
    const urls = hotspot ? publishedPhotoUrls(hotspot.photos, this.sceneHref ?? this.pageHref, this.pageHref) : [];
    const items = urls.map((path) => ({ path }));
    const photos = items.length && hotspot ? filmstrip(items, URL_PHOTOS, (i) => this.lightbox.open(items, i, URL_PHOTOS, hotspot.name), hotspot.name) : null;
    this.present.render({ scene, steps: this.steps(), step: this.step, notes, active: this.active, lede: presentLede(scene), photos });
  }

  private renderHeader(): void {
    const scene = this.scene!;
    this.header.replaceChildren(
      h('div', { class: 'brand' }, h('strong', {}, scene.name), scene.price ? h('span', { class: 'price' }, scene.price) : null),
      this.opts.share === false ? '' : h('button', { type: 'button', class: 'share', onclick: () => void this.share() }, 'Share'),
    );
  }

  /** Customers pass the link on: the share sheet on phones, else the clipboard. */
  private async share(): Promise<void> {
    const scene = this.scene!;
    const page = new URL(this.pageHref);
    const url = typeof this.opts.scene === 'string' ? shareLink(this.pageHref, this.opts.scene) : `${page.origin}${page.pathname}`;
    try {
      if (typeof navigator.share === 'function') return await navigator.share({ title: scene.name, url });
      await navigator.clipboard.writeText(url);
      this.toast('Link copied.', 3000);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') this.toast(`Copy this link: ${url}`, 0);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.lightbox.handleKey(e)) return e.preventDefault();
    if (e.key !== 'k') this.present.kiosk.interact();
    if (e.key === 'ArrowRight' || e.key === ' ') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
    else if (e.key === 'k') this.present.kiosk.toggle();
    else return;
    e.preventDefault();
  }

  private toastTimer = 0;
  private toast(message: string, ms = 0): void {
    clearTimeout(this.toastTimer);
    this.toastEl.hidden = !message;
    this.toastEl.textContent = message;
    if (message && ms) this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  private emit<K extends keyof PresenterEvents>(event: K, detail: PresenterEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as Listener<K>)(detail);
  }
}

function pick(k: PresenterOptions['kiosk']): { interval?: number; idle?: number } {
  const out: { interval?: number; idle?: number } = {};
  if (k?.interval) out.interval = k.interval;
  if (k?.idle) out.idle = k.idle;
  return out;
}

/** Mounts the customer view into a container (see PresenterOptions). */
export function mountPresenter(container: HTMLElement, opts: PresenterOptions): BikePresenter {
  return new BikePresenter(container, opts);
}
