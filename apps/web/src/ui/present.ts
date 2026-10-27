import { Kiosk, type KioskState } from '../scene/kiosk';
import type { Annotation, BikeScene, Hotspot } from '../scene/schema';
import { LeaderLayer } from '../viewer/leaders';
import type { Viewer } from '../viewer/Viewer';
import { h } from './dom';
import { markdownBlock } from './markdown';
import './present.css';

export interface PresentActions {
  go(step: number): void;
  focus(id: string): void;
}

export interface PresentState {
  scene: BikeScene;
  steps: (Hotspot | null)[];
  step: number;
  notes: Annotation[];
  active: string | null;
  lede: string;
  photos: HTMLElement | null;
}

/** Horizontal travel (px) that counts as a swipe on the card. */
const SWIPE = 48;

/**
 * The customer-facing card of Present mode: area title with ‹ ›, progress dots, the area's
 * comments (markdown-lite), photo close-ups, leader lines from the pins, swipe left/right to
 * change area, and a play button for auto-advance (kiosk).
 */
export class PresentView {
  readonly el: HTMLDivElement;
  readonly kiosk: Kiosk;
  private leaders: LeaderLayer;
  private step = 0;
  private shown = false;

  constructor(
    viewer: Viewer,
    stage: HTMLElement,
    private actions: PresentActions,
    kiosk: { interval: number; idle: number },
  ) {
    this.el = h('div', { class: 'present-card', hidden: true, role: 'region', 'aria-label': 'Presentation' });
    this.leaders = new LeaderLayer(viewer, stage);
    // On phones the card is a bottom sheet and the bike renders above it (styles.css), so pins are
    // never hidden behind the card: publish its height to CSS.
    new ResizeObserver(() => stage.style.setProperty('--present-card-h', `${this.el.hidden ? 0 : this.el.offsetHeight}px`)).observe(this.el);
    stage.append(this.el);
    this.el.dataset.kiosk = 'off';
    this.kiosk = new Kiosk({ ...kiosk, onAdvance: () => this.actions.go(this.step + 1), onChange: (s) => this.syncKiosk(s) });
    this.bindSwipe();
    // Any touch on the bike or the card holds auto-advance until the customer has been idle a while.
    const hold = () => this.kiosk.interact();
    stage.addEventListener('pointerdown', hold, { capture: true });
    stage.addEventListener('wheel', hold, { capture: true, passive: true });
    this.stage = stage;
  }

  private stage: HTMLElement;

  hide(): void {
    this.shown = false;
    this.el.hidden = true;
    this.leaders.clear();
    this.stage.style.setProperty('--present-card-h', '0px');
    delete this.stage.dataset.present;
    this.kiosk.stop();
  }

  render(s: PresentState): void {
    this.shown = true;
    this.step = s.step;
    const hotspot = s.steps[s.step];
    this.el.hidden = false;
    // Container-scoped styling hook (no body attributes), so the card works in any host page.
    this.stage.dataset.present = 'on';
    const items = s.notes.map((a) =>
      h(
        'li',
        { class: a.id === s.active ? 'note on' : 'note', dataset: { kind: a.kind, id: a.id }, tabindex: 0, onclick: () => this.actions.focus(a.id), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && this.actions.focus(a.id) },
        h('strong', {}, a.title),
        a.price ? h('span', { class: 'price' }, a.price) : null,
        a.body ? markdownBlock(a.body) : null,
      ),
    );
    const dots = h(
      'div',
      { class: 'dots', role: 'tablist', 'aria-label': 'Areas' },
      ...s.steps.map((st, i) =>
        h('button', {
          type: 'button',
          role: 'tab',
          class: i === s.step ? 'on' : '',
          'aria-selected': String(i === s.step),
          'aria-label': st ? st.name : 'Whole bike',
          onclick: () => this.actions.go(i),
        }),
      ),
    );
    const playing = this.kiosk.state !== 'off';
    this.el.replaceChildren(
      h('div', { class: `kiosk-bar${this.kiosk.state === 'playing' ? ' run' : ''}`, style: `--kiosk-ms: ${this.kiosk.interval}ms` }),
      h(
        'header',
        {},
        h('button', { type: 'button', class: 'nav', 'aria-label': 'Previous area', onclick: () => this.actions.go(s.step - 1) }, '‹'),
        h('div', {}, h('small', {}, `${s.step + 1} / ${s.steps.length}`), h('strong', {}, hotspot ? hotspot.name : s.scene.name)),
        h('button', { type: 'button', class: 'nav', 'aria-label': 'Next area', onclick: () => this.actions.go(s.step + 1) }, '›'),
      ),
      h(
        'div',
        { class: 'present-sub' },
        dots,
        h(
          'button',
          { type: 'button', class: `play${playing ? ' on' : ''}`, 'aria-pressed': String(playing), 'aria-label': playing ? 'Stop auto-play' : 'Auto-play areas', title: 'Auto-play (K)', onclick: () => this.kiosk.toggle() },
          playing ? '❚❚' : '▶',
        ),
      ),
      hotspot ? (items.length ? h('ul', { class: 'notes' }, ...items) : '') : h('p', { class: 'lede' }, s.lede),
      s.photos ?? '',
    );
    // Lines from every pin of this area to the card; the active comment's line stands out.
    this.leaders.set(
      s.notes.map((a) => ({ position: a.position, target: this.el, active: a.id === s.active })),
      this.el,
    );
  }

  private syncKiosk(state: KioskState): void {
    if (!this.shown) return;
    const playing = state !== 'off';
    const bar = this.el.querySelector('.kiosk-bar');
    bar?.classList.toggle('run', state === 'playing');
    const btn = this.el.querySelector<HTMLButtonElement>('.play');
    if (btn) {
      btn.classList.toggle('on', playing);
      btn.textContent = playing ? '❚❚' : '▶';
      btn.setAttribute('aria-pressed', String(playing));
      btn.setAttribute('aria-label', playing ? 'Stop auto-play' : 'Auto-play areas');
    }
    this.el.dataset.kiosk = state;
  }

  /** Swipe left/right on the card changes area; vertical drags still scroll it. */
  private bindSwipe(): void {
    let start: { id: number; x: number; y: number } | null = null;
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.filmstrip')) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      // Swallow the click that may follow, so a swipe that ends on a comment does not also select it.
      const swallow = (c: Event) => c.stopPropagation();
      this.el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => this.el.removeEventListener('click', swallow, { capture: true }), 0);
      this.actions.go(this.step + (dx < 0 ? 1 : -1));
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', () => (start = null));
  }
}
