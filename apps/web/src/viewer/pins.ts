import type { Annotation } from '../scene/schema';
import type { Viewer } from './Viewer';

/**
 * HTML pins tracking annotation points on the model. Pins behind the bike are dimmed
 * rather than hidden so a salesperson can still see that a comment exists there.
 * Occlusion raycasts are spread across frames to stay cheap with many comments.
 */
export class PinLayer {
  readonly el: HTMLDivElement;
  private pins = new Map<string, { el: HTMLButtonElement; annotation: Annotation }>();
  private occlusionCursor = 0;
  private activeId: string | null = null;
  private visibleIds: Set<string> | null = null;

  constructor(
    private viewer: Viewer,
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
        pin = { el, annotation };
        this.pins.set(annotation.id, pin);
      }
      pin.annotation = annotation;
      pin.el.textContent = String(i + 1);
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
    this.refreshClasses();
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

  private update(): void {
    const entries = [...this.pins.values()];
    for (const { el, annotation } of entries) {
      const p = this.viewer.project(annotation.position);
      if (!p) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.translate = `${p.x}px ${p.y}px`;
    }
    // A few occlusion checks per frame.
    const n = Math.min(entries.length, 4);
    for (let i = 0; i < n; i++) {
      this.occlusionCursor = (this.occlusionCursor + 1) % entries.length;
      const { el, annotation } = entries[this.occlusionCursor];
      el.classList.toggle('occluded', this.viewer.isOccluded(annotation.position));
    }
  }
}
