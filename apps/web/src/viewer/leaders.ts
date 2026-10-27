import * as THREE from 'three';
import type { Vec3 } from '../scene/schema';
import type { Viewer } from './Viewer';

const SVG = 'http://www.w3.org/2000/svg';

interface Leader {
  position: Vec3;
  /** The card element the line ends at. */
  target: HTMLElement;
  /** Target rect relative to the stage, cached: reading layout every frame would thrash. */
  rect: { left: number; top: number; right: number; bottom: number };
  active: boolean;
}

/**
 * Leader lines from comment pins to their cards in Present mode: an SVG overlay updated every
 * frame with no per-frame allocation (a scratch vector, pooled line elements, cached card rects
 * refreshed only when the card scrolls or resizes).
 */
export class LeaderLayer {
  readonly el: SVGSVGElement;
  private leaders: Leader[] = [];
  private lines: { line: SVGLineElement; dot: SVGCircleElement }[] = [];
  private scratch = new THREE.Vector3();
  private observer: ResizeObserver;
  private observed: Element | null = null;

  constructor(
    private viewer: Viewer,
    private stage: HTMLElement,
  ) {
    this.el = document.createElementNS(SVG, 'svg');
    this.el.setAttribute('class', 'leader-layer');
    this.el.setAttribute('aria-hidden', 'true');
    stage.appendChild(this.el);
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(stage);
    viewer.onFrame(() => this.update());
  }

  /** Lines from each comment position to its element; an empty list hides the layer. */
  set(items: { position: Vec3; target: HTMLElement; active: boolean }[], container: HTMLElement | null): void {
    this.leaders = items.map((x) => ({ ...x, rect: { left: 0, top: 0, right: 0, bottom: 0 } }));
    while (this.lines.length < this.leaders.length) {
      const line = document.createElementNS(SVG, 'line');
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('r', '4');
      this.el.append(line, dot);
      this.lines.push({ line, dot });
    }
    this.lines.forEach(({ line, dot }, i) => {
      const leader = this.leaders[i];
      const cls = leader ? (leader.active ? 'active' : '') : 'off';
      line.setAttribute('class', cls);
      dot.setAttribute('class', cls);
    });
    if (container !== this.observed) {
      if (this.observed) {
        this.observer.unobserve(this.observed);
        this.observed.removeEventListener('scroll', this.onScroll);
      }
      this.observed = container;
      if (container) {
        this.observer.observe(container);
        container.addEventListener('scroll', this.onScroll, { passive: true });
      }
    }
    this.measure();
  }

  clear(): void {
    this.set([], null);
  }

  private onScroll = () => this.measure();

  /** Caches card rects relative to the stage. */
  measure(): void {
    const s = this.stage.getBoundingClientRect();
    for (const l of this.leaders) {
      const r = l.target.getBoundingClientRect();
      l.rect.left = r.left - s.left;
      l.rect.top = r.top - s.top;
      l.rect.right = r.right - s.left;
      l.rect.bottom = r.bottom - s.top;
    }
  }

  private update(): void {
    if (!this.leaders.length) return;
    const { camera, modelRoot } = this.viewer;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    for (let i = 0; i < this.leaders.length; i++) {
      const { position, rect, active } = this.leaders[i];
      const { line, dot } = this.lines[i];
      const v = this.scratch.set(position[0], position[1], position[2]).applyMatrix4(modelRoot.matrixWorld).project(camera);
      // Hidden when behind the camera or when the card element is scrolled out of view.
      const visible = v.z <= 1 && rect.bottom > rect.top && rect.right > rect.left;
      if (!visible) {
        line.setAttribute('class', 'off');
        dot.setAttribute('class', 'off');
        continue;
      }
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      // End on the card's nearest edge point, inset from its rounded corners.
      const ex = Math.min(Math.max(x, rect.left + 12), rect.right - 12);
      const ey = y < rect.top ? rect.top : y > rect.bottom ? rect.bottom : Math.min(Math.max(y, rect.top + 12), rect.bottom - 12);
      line.setAttribute('x1', x.toFixed(1));
      line.setAttribute('y1', y.toFixed(1));
      line.setAttribute('x2', ex.toFixed(1));
      line.setAttribute('y2', ey.toFixed(1));
      dot.setAttribute('cx', ex.toFixed(1));
      dot.setAttribute('cy', ey.toFixed(1));
      const cls = active ? 'active' : '';
      if (line.getAttribute('class') !== cls) {
        line.setAttribute('class', cls);
        dot.setAttribute('class', cls);
      }
    }
  }
}
