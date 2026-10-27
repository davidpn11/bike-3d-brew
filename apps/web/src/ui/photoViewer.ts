import type { RankedPhoto } from '../scene/photos';
import { h } from './dom';
import type { PhotoLibrary } from './photoLibrary';

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Where photos come from: a capture's PhotoLibrary, or plain URLs of a published scene. */
export type PhotoSource = Pick<PhotoLibrary, 'get' | 'errors'>;

/** A horizontal strip of close-up thumbnails; thumbnails fill in as they decode. */
export function filmstrip(photos: Pick<RankedPhoto, 'path'>[], lib: PhotoSource, onOpen: (index: number) => void, label: string): HTMLElement {
  const tiles = photos.map((p, i) => {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: false });
    const tile = h(
      'button',
      {
        type: 'button',
        class: 'photo loading',
        title: fileName(p.path),
        'aria-label': `Photo ${i + 1} of ${photos.length}: ${label}`,
        onclick: (e: Event) => (e.stopPropagation(), onOpen(i)),
      },
      img,
    );
    void lib.get(p.path, 'thumb').then((url) => {
      tile.classList.remove('loading');
      if (url) img.src = url;
      else {
        tile.classList.add('missing');
        tile.title = lib.errors.get(p.path) ?? `${fileName(p.path)} is not stored in this browser`;
      }
    });
    return tile;
  });
  return h('div', { class: 'filmstrip', role: 'list', 'aria-label': `Close-up photos: ${label}` }, ...tiles);
}

interface Item {
  path: string;
  caption: string;
}

/**
 * Full-screen photo viewer: arrows / swipe to step, pinch / wheel / double-tap to zoom, drag to
 * pan while zoomed, Esc or × to close.
 */
export class Lightbox {
  readonly el: HTMLDivElement;
  private img: HTMLImageElement;
  private counter: HTMLElement;
  private caption: HTMLElement;
  private status: HTMLElement;
  private items: Item[] = [];
  private index = 0;
  private lib: PhotoSource | null = null;
  private zoom = { s: 1, x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { x: number; y: number; dist: number; s: number; tx: number; ty: number; moved: boolean } | null = null;
  private lastTap = 0;
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.img = h('img', { alt: '', draggable: false });
    this.counter = h('span', { class: 'count' });
    this.caption = h('span', { class: 'caption' });
    this.status = h('p', { class: 'status' });
    const stage = h('div', { class: 'lb-stage' }, this.img, this.status);
    this.el = h(
      'div',
      { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer', hidden: true },
      h('header', {}, this.counter, this.caption, h('button', { type: 'button', class: 'lb-close', 'aria-label': 'Close photo', onclick: () => this.close() }, '×')),
      stage,
      h('button', { type: 'button', class: 'lb-nav prev', 'aria-label': 'Previous photo', onclick: () => this.go(-1) }, '‹'),
      h('button', { type: 'button', class: 'lb-nav next', 'aria-label': 'Next photo', onclick: () => this.go(1) }, '›'),
    );
    parent.append(this.el);
    this.bindGestures(stage);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(photos: Pick<RankedPhoto, 'path'>[], index: number, lib: PhotoSource, label: string): void {
    this.items = photos.map((p) => ({ path: p.path, caption: `${label} · ${fileName(p.path)}` }));
    this.lib = lib;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    this.show(index);
    (this.el.querySelector('.lb-close') as HTMLElement).focus();
  }

  close(): void {
    this.el.hidden = true;
    this.img.removeAttribute('src');
    this.returnFocus?.focus?.();
  }

  go(delta: number): void {
    if (this.items.length) this.show((this.index + delta + this.items.length) % this.items.length);
  }

  /** Keyboard handling while open; returns true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.go(1);
    else if (e.key === 'ArrowLeft') this.go(-1);
    else return e.key === ' ';
    return true;
  }

  private show(index: number): void {
    this.index = index;
    const item = this.items[index];
    this.setZoom(1, 0, 0);
    this.counter.textContent = `${index + 1} / ${this.items.length}`;
    this.caption.textContent = item.caption;
    this.img.removeAttribute('src');
    this.status.textContent = 'Loading photo…';
    this.status.hidden = false;
    const lib = this.lib!;
    void lib.get(item.path, 'full').then((url) => {
      if (this.items[this.index] !== item) return;
      if (url) {
        this.img.src = url;
        this.status.hidden = true;
      } else {
        this.status.textContent = lib.errors.get(item.path) ?? 'This photo is not stored in this browser. Drop the .bikecapture.zip again to see it.';
      }
    });
    // Warm up the neighbours so swiping feels instant.
    for (const d of [1, -1]) {
      const n = this.items[(index + d + this.items.length) % this.items.length];
      if (n !== item) void lib.get(n.path, 'full');
    }
  }

  private setZoom(s: number, x: number, y: number): void {
    const clamped = Math.min(5, Math.max(1, s));
    this.zoom = clamped === 1 ? { s: 1, x: 0, y: 0 } : { s: clamped, x, y };
    this.img.style.transform = `translate(${this.zoom.x}px, ${this.zoom.y}px) scale(${this.zoom.s})`;
    this.el.classList.toggle('zoomed', this.zoom.s > 1);
  }

  private bindGestures(stage: HTMLElement): void {
    const center = () => {
      const pts = [...this.pointers.values()];
      return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    };
    const spread = () => {
      const [a, b] = [...this.pointers.values()];
      return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const begin = () => {
      const c = center();
      this.gesture = { x: c.x, y: c.y, dist: spread(), s: this.zoom.s, tx: this.zoom.x, ty: this.zoom.y, moved: this.gesture?.moved ?? false };
    };
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.gesture = null;
      begin();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId) || !this.gesture) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      const c = center();
      if (Math.hypot(c.x - g.x, c.y - g.y) > 6) g.moved = true;
      if (this.pointers.size >= 2 && g.dist > 0) {
        g.moved = true;
        this.setZoom((g.s * spread()) / g.dist, g.tx + c.x - g.x, g.ty + c.y - g.y);
      } else if (this.zoom.s > 1) {
        this.setZoom(this.zoom.s, g.tx + c.x - g.x, g.ty + c.y - g.y);
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      const g = this.gesture;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size) return begin();
      this.gesture = null;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (this.zoom.s === 1 && g.moved && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) return this.go(dx < 0 ? 1 : -1);
      if (!g.moved) {
        const now = performance.now();
        if (now - this.lastTap < 320) {
          this.lastTap = 0;
          this.setZoom(this.zoom.s > 1 ? 1 : 2.5, 0, 0);
        } else this.lastTap = now;
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom.s * Math.exp(-e.deltaY * 0.002), this.zoom.x, this.zoom.y);
      },
      { passive: false },
    );
  }
}
