import type { Annotation } from '../scene/schema';
import type { Viewer } from './Viewer';

/** The part of Viewer the pin layer uses (tests pass a fake). */
export type PinViewer = Pick<Viewer, 'onFrame' | 'projectInto' | 'isOccluded' | 'requestRender' | 'viewport' | 'raycastReady'>;

interface Pin {
  el: HTMLButtonElement;
  annotation: Annotation;
  /** Last written screen position, so unchanged pins cost no style write. */
  x: number;
  y: number;
  /** On screen and in front of the camera. */
  shown: boolean;
  occluded: boolean;
  /** View generation this pin's occlusion was last tested at. */
  checked: number;
}

/** Pins this far outside the stage (px) still count as on screen, so they slide out instead of popping. */
const MARGIN = 24;
/** Moves smaller than this (px) are not written: sub-pixel jitter while damping settles. */
const EPSILON = 0.05;

/**
 * HTML pins tracking annotation points on the model. Pins behind the bike are dimmed rather than
 * hidden so a salesperson can still see that a comment exists there.
 *
 * Cost per drawn frame with N pins: N matrix projections into a scratch object, a transform write
 * only for pins that moved (nothing else touches layout; the stage size is cached by the Viewer), a
 * class flip only when a pin leaves the screen. Occlusion raycasts run under a time budget, newest
 * view first, and continue on idle animation frames after the camera stops, so 50+ pins never
 * stall orbiting; until the model's BVH exists a big capture skips them entirely.
 */
export class PinLayer {
  readonly el: HTMLDivElement;
  private pins = new Map<string, Pin>();
  private order: Pin[] = [];
  private activeId: string | null = null;
  private visibleIds: Set<string> | null = null;
  /** Bumped on every drawn frame (the view changed): occlusion results older than this are stale. */
  private generation = 0;
  private cursor = 0;
  private occlusionFrame = 0;
  private readonly point = { x: 0, y: 0 };
  /** Milliseconds of occlusion raycasts allowed per animation frame. */
  occlusionBudgetMs = 3;

  constructor(
    private viewer: PinViewer,
    parent: HTMLElement,
    private onSelect: (id: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pin-layer';
    parent.appendChild(this.el);
    viewer.onFrame(() => this.update());
  }

  setAnnotations(annotations: Annotation[]): void {
    const seen = new Set<string>();
    annotations.forEach((annotation, i) => {
      seen.add(annotation.id);
      let pin = this.pins.get(annotation.id);
      if (!pin) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'pin';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onSelect(annotation.id);
        });
        this.el.appendChild(el);
        pin = { el, annotation, x: NaN, y: NaN, shown: true, occluded: false, checked: -1 };
        this.pins.set(annotation.id, pin);
      }
      if (pin.annotation.position !== annotation.position) pin.checked = -1;
      pin.annotation = annotation;
      const label = String(i + 1);
      if (pin.el.textContent !== label) pin.el.textContent = label;
      pin.el.dataset.kind = annotation.kind;
      pin.el.title = annotation.title;
      pin.el.setAttribute('aria-label', `Comment ${i + 1}: ${annotation.title}`);
    });
    for (const [id, pin] of this.pins) {
      if (!seen.has(id)) {
        pin.el.remove();
        this.pins.delete(id);
      }
    }
    this.order = [...this.pins.values()];
    this.refreshClasses();
    // Positions are only written on drawn frames; a new or moved pin needs one.
    this.viewer.requestRender();
  }

  /** Restricts pins to a set (e.g. the comments of the focused area); null shows all. */
  filter(ids: string[] | null): void {
    this.visibleIds = ids ? new Set(ids) : null;
    this.refreshClasses();
  }

  setActive(id: string | null): void {
    this.activeId = id;
    this.refreshClasses();
  }

  private refreshClasses(): void {
    for (const [id, { el }] of this.pins) {
      el.classList.toggle('active', id === this.activeId);
      el.classList.toggle('filtered', !!this.visibleIds && !this.visibleIds.has(id));
    }
  }

  /** Runs after every drawn frame. */
  update(): void {
    this.generation++;
    const { width, height } = this.viewer.viewport;
    const p = this.point;
    for (const pin of this.order) {
      const front = this.viewer.projectInto(pin.annotation.position, p);
      const shown = front && p.x > -MARGIN && p.y > -MARGIN && p.x < width + MARGIN && p.y < height + MARGIN;
      if (shown !== pin.shown) {
        pin.shown = shown;
        pin.el.classList.toggle('offscreen', !shown);
      }
      if (!shown) continue;
      if (Math.abs(p.x - pin.x) < EPSILON && Math.abs(p.y - pin.y) < EPSILON) continue;
      pin.x = p.x;
      pin.y = p.y;
      pin.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
    this.checkOcclusion();
  }

  /**
   * Tests stale pins against the model until the budget runs out (at least one per call), then
   * keeps going on later animation frames (without re-rendering) until every shown pin is current.
   */
  private checkOcclusion(): void {
    if (!this.viewer.raycastReady || !this.order.length) return;
    const deadline = performance.now() + this.occlusionBudgetMs;
    const n = this.order.length;
    let tested = 0;
    for (let scanned = 0; scanned < n; scanned++) {
      const pin = this.order[(this.cursor = (this.cursor + 1) % n)];
      if (pin.checked === this.generation) continue;
      if (!pin.shown) {
        // Off screen: test when it comes back into view.
        pin.checked = this.generation;
        continue;
      }
      if (tested > 0 && performance.now() > deadline) {
        this.scheduleOcclusion();
        return;
      }
      tested++;
      pin.checked = this.generation;
      const occluded = this.viewer.isOccluded(pin.annotation.position);
      if (occluded !== pin.occluded) {
        pin.occluded = occluded;
        pin.el.classList.toggle('occluded', occluded);
      }
    }
  }

  private scheduleOcclusion(): void {
    if (this.occlusionFrame) return;
    this.occlusionFrame = requestAnimationFrame(() => {
      this.occlusionFrame = 0;
      this.checkOcclusion();
    });
  }
}
