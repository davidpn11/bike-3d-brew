import { viewForPoint } from '../scene/camera';
import {
  ANNOTATION_KINDS,
  type Annotation,
  type AnnotationKind,
  BACKGROUND_MODES,
  type BackgroundMode,
  type BikeScene,
  type Hotspot,
  type ModelRef,
  type Vec3,
  emptyScene,
  formatFromFilename,
  parseScene,
} from '../scene/schema';
import type { SceneStore } from '../scene/store';
import { centerOnGround, loadModel } from '../viewer/loaders';
import { PinLayer } from '../viewer/pins';
import type { Viewer } from '../viewer/Viewer';
import { download, h, slugify } from './dom';

export type Mode = 'view' | 'edit' | 'present';

interface Draft {
  /** Set when editing an existing comment. */
  id?: string;
  position: Vec3;
  normal?: Vec3;
}

const KIND_LABEL: Record<AnnotationKind, string> = { feature: 'Feature', spec: 'Spec', upgrade: 'Upgrade', note: 'Note' };
const BG_LABEL: Record<BackgroundMode, string> = { transparent: 'Clear', green: 'Green', studio: 'Studio', dark: 'Dark' };

export interface AppElements {
  topbar: HTMLElement;
  stage: HTMLElement;
  panel: HTMLElement;
}

export class App {
  mode: Mode = 'view';
  activeHotspot: string | null = null;
  activeAnnotation: string | null = null;
  presentStep = 0;
  private draft: Draft | null = null;
  private draftPin: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private presentEl: HTMLDivElement;
  private pins: PinLayer;
  /** Dropped model files by filename, so scenes can reference them by name. */
  private modelFiles = new Map<string, string>();
  private loadedModelKey = '';

  constructor(
    private store: SceneStore,
    private viewer: Viewer,
    private els: AppElements,
    private baseUrl: string,
  ) {
    this.pins = new PinLayer(viewer, els.stage, (id) => this.focusAnnotation(id));
    this.draftPin = h('div', { class: 'pin draft', hidden: true }, '+');
    this.toastEl = h('div', { class: 'toast', role: 'status', hidden: true });
    this.presentEl = h('div', { class: 'present-card', hidden: true });
    els.stage.append(this.draftPin, this.toastEl, this.presentEl);
    viewer.onFrame(() => this.positionDraftPin());

    store.subscribe(() => this.render());
    this.bindStage();
    this.bindKeys();
  }

  /** Loads the scene's model (if changed) and syncs everything to the store. */
  async open(scene: BikeScene, opts: { frame?: boolean } = {}): Promise<void> {
    this.store.replace(scene);
    await this.syncModel(scene.model);
    if (opts.frame !== false) this.viewer.setView(this.viewer.overviewView());
  }

  async syncModel(ref: ModelRef): Promise<void> {
    const key = `${ref.format}:${ref.url}`;
    if (key === this.loadedModelKey) {
      this.viewer.applyTransform(ref);
      return;
    }
    const url = this.resolveModelUrl(ref);
    if (!url) {
      this.toast(`Model “${ref.url}” is not loaded. Drop the file onto the viewer to reopen it.`, 'error', 0);
      return;
    }
    this.toast('Loading model…', 'info', 0);
    try {
      const object = await loadModel(url, ref.format);
      this.viewer.setModel(centerOnGround(object), ref);
      this.loadedModelKey = key;
      this.toast('');
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'error', 0);
    }
  }

  setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.draft = null;
    document.body.dataset.mode = mode;
    if (mode === 'present') this.goToStep(0);
    else this.presentEl.hidden = true;
    if (mode === 'edit') this.toast('Edit mode: tap the bike to pin a comment.', 'info');
    this.render();
  }

  render(): void {
    const scene = this.store.scene;
    this.viewer.setBackground(scene.background);
    this.pins.setAnnotations(scene.annotations);
    this.pins.filter(this.activeHotspot ? this.store.annotationsFor(this.activeHotspot).map((a) => a.id) : null);
    this.pins.setActive(this.activeAnnotation);
    this.renderTopbar(scene);
    this.renderPanel(scene);
    if (this.mode === 'present') this.renderPresent(scene);
  }

  // ---------------------------------------------------------------- navigation

  async focusHotspot(id: string | null): Promise<void> {
    this.activeHotspot = id;
    this.activeAnnotation = null;
    this.render();
    const hotspot = this.store.scene.hotspots.find((x) => x.id === id);
    await this.viewer.flyTo(hotspot ? hotspot.view : this.viewer.overviewView());
  }

  async focusAnnotation(id: string): Promise<void> {
    const a = this.store.scene.annotations.find((x) => x.id === id);
    if (!a) return;
    this.activeAnnotation = id;
    if (this.mode === 'present') {
      const step = this.presentSteps().findIndex((s) => s?.id === a.hotspotId);
      if (step >= 0) this.presentStep = step;
    } else if (a.hotspotId && this.activeHotspot && a.hotspotId !== this.activeHotspot) {
      this.activeHotspot = a.hotspotId;
    }
    this.render();
    this.panelCard(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const hotspot = this.store.scene.hotspots.find((h) => h.id === a.hotspotId);
    const radius = hotspot ? dist(hotspot.view.position, hotspot.view.target) * 0.75 : 0.6;
    await this.viewer.flyTo(viewForPoint(a.position, a.normal, this.viewer.getView().position, Math.max(0.25, radius)));
  }

  private presentSteps(): (Hotspot | null)[] {
    return [null, ...this.store.scene.hotspots];
  }

  goToStep(step: number): void {
    const steps = this.presentSteps();
    this.presentStep = (step + steps.length) % steps.length;
    const hotspot = steps[this.presentStep];
    void this.focusHotspot(hotspot ? hotspot.id : null);
  }

  // ---------------------------------------------------------------- top bar

  private renderTopbar(scene: BikeScene): void {
    const bg = h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': 'Background' },
      ...BACKGROUND_MODES.map((m) =>
        h('button', { type: 'button', class: m === scene.background ? 'on' : '', dataset: { bg: m }, onclick: () => this.store.update({ background: m }) }, BG_LABEL[m]),
      ),
    );
    const modes = h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': 'Mode' },
      ...(['view', 'edit', 'present'] as Mode[]).map((m) =>
        h('button', { type: 'button', class: m === this.mode ? 'on' : '', onclick: () => this.setMode(m) }, m[0].toUpperCase() + m.slice(1)),
      ),
    );
    const fileInput = h('input', {
      type: 'file',
      accept: '.glb,.gltf,.usdz,.ply,.json',
      hidden: true,
      onchange: (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) void this.openFile(file);
      },
    });
    const menu = h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', onclick: () => fileInput.click(), title: 'Open a model (GLB, USDZ, PLY) or a scene JSON' }, 'Open…'),
      h('button', { type: 'button', onclick: () => download(`${slugify(scene.name)}.bike.json`, this.store.toJSON()) }, 'Export'),
      h('button', { type: 'button', onclick: () => download(`${slugify(scene.name)}.png`, dataUrlToBlob(this.viewer.screenshot())) }, 'Snapshot'),
      h('button', { type: 'button', onclick: () => void this.focusHotspot(null) }, 'Reset view'),
      fileInput,
    );
    this.els.topbar.replaceChildren(
      h('div', { class: 'brand' }, h('strong', {}, scene.name), scene.price ? h('span', { class: 'price' }, scene.price) : null),
      modes,
      bg,
      menu,
    );
  }

  // ---------------------------------------------------------------- side panel

  private renderPanel(scene: BikeScene): void {
    const editing = this.mode === 'edit';
    const sections: HTMLElement[] = [];

    if (editing) sections.push(this.detailsEditor(scene));

    const areas = h(
      'ul',
      { class: 'areas' },
      h('li', {}, h('button', { type: 'button', class: this.activeHotspot === null ? 'on' : '', onclick: () => void this.focusHotspot(null) }, 'Whole bike', h('small', {}, String(scene.annotations.length)))),
      ...scene.hotspots.map((hs) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: this.activeHotspot === hs.id ? 'on' : '', onclick: () => void this.focusHotspot(hs.id) },
            hs.name,
            h('small', {}, String(this.store.annotationsFor(hs.id).length)),
          ),
          editing
            ? h(
                'span',
                { class: 'row-actions' },
                h('button', { type: 'button', title: 'Use current camera for this area', onclick: () => this.store.updateHotspot(hs.id, { view: this.viewer.getView() }) }, 'Set view'),
                h('button', { type: 'button', title: 'Rename', onclick: () => this.renameHotspot(hs) }, 'Rename'),
                h('button', { type: 'button', class: 'danger', title: 'Delete area', onclick: () => this.deleteHotspot(hs) }, '×'),
              )
            : null,
        ),
      ),
    );
    sections.push(
      h(
        'section',
        {},
        h('h2', {}, 'Areas'),
        areas,
        editing ? h('button', { type: 'button', class: 'add', onclick: () => this.addHotspotFromView() }, '+ Save current view as area') : null,
      ),
    );

    if (this.draft) sections.push(this.commentEditor(scene, this.draft));

    const list = this.activeHotspot ? this.store.annotationsFor(this.activeHotspot) : scene.annotations;
    const numberOf = new Map(scene.annotations.map((a, i) => [a.id, i + 1]));
    sections.push(
      h(
        'section',
        {},
        h('h2', {}, 'Comments'),
        list.length === 0
          ? h('p', { class: 'empty' }, editing ? 'Tap the bike to pin a comment here.' : 'No comments for this area yet.')
          : h('ol', { class: 'comments' }, ...list.map((a) => this.commentCard(a, numberOf.get(a.id) ?? 0, editing))),
      ),
    );
    this.els.panel.replaceChildren(...sections);
  }

  private detailsEditor(scene: BikeScene): HTMLElement {
    const field = (label: string, value: string, onChange: (v: string) => void) =>
      h('label', {}, label, h('input', { value, onchange: (e: Event) => onChange((e.target as HTMLInputElement).value.trim()) }));
    return h(
      'section',
      { class: 'details' },
      h('h2', {}, 'Bike'),
      field('Name', scene.name, (v) => this.store.update({ name: v || 'Untitled bike' })),
      field('Brand', scene.brand ?? '', (v) => this.store.update({ brand: v || undefined })),
      field('Model', scene.modelName ?? '', (v) => this.store.update({ modelName: v || undefined })),
      field('Price', scene.price ?? '', (v) => this.store.update({ price: v || undefined })),
    );
  }

  private commentCard(a: Annotation, n: number, editing: boolean): HTMLElement {
    const area = this.store.scene.hotspots.find((x) => x.id === a.hotspotId);
    return h(
      'li',
      { class: `comment${a.id === this.activeAnnotation ? ' on' : ''}`, dataset: { id: a.id, kind: a.kind }, onclick: () => void this.focusAnnotation(a.id) },
      h('span', { class: 'num' }, String(n)),
      h(
        'div',
        { class: 'body' },
        h('div', { class: 'meta' }, h('span', { class: 'kind' }, KIND_LABEL[a.kind]), area && !this.activeHotspot ? h('span', { class: 'area' }, area.name) : null, a.price ? h('span', { class: 'price' }, a.price) : null),
        h('strong', {}, a.title || 'Untitled'),
        a.body ? h('p', {}, a.body) : null,
        editing
          ? h(
              'span',
              { class: 'row-actions' },
              h('button', { type: 'button', onclick: (e: Event) => (e.stopPropagation(), this.editComment(a)) }, 'Edit'),
              h('button', { type: 'button', class: 'danger', onclick: (e: Event) => (e.stopPropagation(), this.deleteComment(a)) }, 'Delete'),
            )
          : null,
      ),
    );
  }

  private commentEditor(scene: BikeScene, draft: Draft): HTMLElement {
    const existing = draft.id ? scene.annotations.find((a) => a.id === draft.id) : undefined;
    const title = h('input', { name: 'title', required: true, placeholder: 'e.g. Full carbon fork', value: existing?.title ?? '' });
    const body = h('textarea', { name: 'body', rows: 3, placeholder: 'What should the customer know?' });
    body.value = existing?.body ?? '';
    const kind = h('select', { name: 'kind' }, ...ANNOTATION_KINDS.map((k) => h('option', { value: k, selected: (existing?.kind ?? 'feature') === k }, KIND_LABEL[k])));
    const price = h('input', { name: 'price', placeholder: '+$350 / included', value: existing?.price ?? '' });
    const defaultArea = existing ? existing.hotspotId : (this.activeHotspot ?? nearestHotspot(scene.hotspots, draft.position)?.id);
    const area = h(
      'select',
      { name: 'area' },
      h('option', { value: '' }, '— none —'),
      ...scene.hotspots.map((hs) => h('option', { value: hs.id, selected: hs.id === defaultArea }, hs.name)),
    );
    const form = h(
      'form',
      {
        class: 'editor',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const data = {
            title: title.value.trim(),
            body: body.value.trim(),
            kind: kind.value as AnnotationKind,
            price: price.value.trim() || undefined,
            hotspotId: area.value || undefined,
          };
          let id = draft.id;
          if (id) this.store.updateAnnotation(id, data);
          else id = this.store.addAnnotation({ ...data, position: draft.position, normal: draft.normal }).id;
          this.draft = null;
          this.activeAnnotation = id;
          this.render();
        },
      },
      h('h2', {}, existing ? 'Edit comment' : 'New comment'),
      h('label', {}, 'Title', title),
      h('label', {}, 'Details', body),
      h('div', { class: 'row' }, h('label', {}, 'Type', kind), h('label', {}, 'Price', price)),
      h('label', {}, 'Area', area),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'submit', class: 'primary' }, 'Save'),
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              this.draft = null;
              this.render();
            },
          },
          'Cancel',
        ),
      ),
    );
    queueMicrotask(() => title.focus());
    return form;
  }

  private renderPresent(scene: BikeScene): void {
    const steps = this.presentSteps();
    const hotspot = steps[this.presentStep];
    const notes = hotspot ? this.store.annotationsFor(hotspot.id) : [];
    this.presentEl.hidden = false;
    const details = hotspot
      ? notes.length
        ? h(
            'ul',
            {},
            ...notes.map((a) =>
              h(
                'li',
                { class: a.id === this.activeAnnotation ? 'on' : '', dataset: { kind: a.kind }, onclick: () => void this.focusAnnotation(a.id) },
                h('strong', {}, a.title),
                a.price ? h('span', { class: 'price' }, a.price) : null,
                a.body ? h('p', {}, a.body) : null,
              ),
            ),
          )
        : ''
      : h('p', { class: 'lede' }, [scene.brand, scene.modelName, scene.year].filter(Boolean).join(' · ') || 'Swipe through the highlights →');
    this.presentEl.replaceChildren(
      h(
        'header',
        {},
        h('button', { type: 'button', 'aria-label': 'Previous area', onclick: () => this.goToStep(this.presentStep - 1) }, '‹'),
        h('div', {}, h('small', {}, `${this.presentStep + 1} / ${steps.length}`), h('strong', {}, hotspot ? hotspot.name : scene.name)),
        h('button', { type: 'button', 'aria-label': 'Next area', onclick: () => this.goToStep(this.presentStep + 1) }, '›'),
      ),
      details,
    );
  }

  // ---------------------------------------------------------------- editing actions

  private addHotspotFromView(): void {
    const name = prompt('Name this area (e.g. Fork, Drivetrain):')?.trim();
    if (!name) return;
    const hs = this.store.addHotspot({ name, view: this.viewer.getView() });
    this.activeHotspot = hs.id;
    this.render();
  }

  private renameHotspot(hs: Hotspot): void {
    const name = prompt('Rename area:', hs.name)?.trim();
    if (name) this.store.updateHotspot(hs.id, { name });
  }

  private deleteHotspot(hs: Hotspot): void {
    if (!confirm(`Delete area “${hs.name}”? Its comments are kept.`)) return;
    if (this.activeHotspot === hs.id) this.activeHotspot = null;
    this.store.removeHotspot(hs.id);
  }

  private editComment(a: Annotation): void {
    this.draft = { id: a.id, position: a.position, normal: a.normal };
    this.render();
  }

  private deleteComment(a: Annotation): void {
    if (!confirm(`Delete comment “${a.title}”?`)) return;
    if (this.activeAnnotation === a.id) this.activeAnnotation = null;
    this.store.removeAnnotation(a.id);
  }

  // ---------------------------------------------------------------- input

  private bindStage(): void {
    const canvas = this.viewer.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const isTap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 500;
      down = null;
      if (!isTap || this.mode !== 'edit') return;
      const hit = this.viewer.pick(e.clientX, e.clientY);
      if (!hit) return;
      this.draft = { position: hit.position, normal: hit.normal };
      this.render();
    });

    const stage = this.els.stage;
    stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      stage.classList.add('dropping');
    });
    stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      stage.classList.remove('dropping');
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.openFile(file);
    });
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (this.mode === 'present') {
        if (e.key === 'ArrowRight' || e.key === ' ') this.goToStep(this.presentStep + 1);
        else if (e.key === 'ArrowLeft') this.goToStep(this.presentStep - 1);
        else if (e.key === 'Escape') this.setMode('view');
      } else if (e.key === 'Escape' && this.draft) {
        this.draft = null;
        this.render();
      }
    });
  }

  async openFile(file: File): Promise<void> {
    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const scene = parseScene(JSON.parse(await file.text()));
        await this.open(scene);
        this.toast(`Opened “${scene.name}”.`, 'info');
      } catch (err) {
        this.toast(`Not a bike scene: ${err instanceof Error ? err.message : String(err)}`, 'error', 0);
      }
      return;
    }
    const format = formatFromFilename(file.name);
    if (!format) {
      this.toast('Unsupported file. Use .glb, .gltf, .usdz, .ply or a .bike.json scene.', 'error');
      return;
    }
    const previous = this.modelFiles.get(file.name);
    if (previous) URL.revokeObjectURL(previous);
    this.modelFiles.set(file.name, URL.createObjectURL(file));
    this.loadedModelKey = '';
    const current = this.store.scene;
    // Re-dropping the file a saved scene references restores that scene; anything else starts a new bike.
    if (current.model.url === file.name) await this.open(current, { frame: false });
    else await this.open(emptyScene({ url: file.name, format }, file.name.replace(/\.[^.]+$/, '')));
  }

  private resolveModelUrl(ref: ModelRef): string | null {
    if (ref.format === 'demo') return ref.url;
    const dropped = this.modelFiles.get(ref.url);
    if (dropped) return dropped;
    if (/^(blob:|data:)/.test(ref.url)) return null;
    // Bare filenames without a known base (a scene saved from a dropped file) cannot be fetched.
    if (!ref.url.includes('/') && !/^https?:/.test(ref.url) && this.baseUrl === location.href) return null;
    return new URL(ref.url, this.baseUrl).href;
  }

  // ---------------------------------------------------------------- helpers

  private toastTimer = 0;
  toast(message: string, tone: 'info' | 'error' = 'info', ms = 3500): void {
    clearTimeout(this.toastTimer);
    this.toastEl.hidden = !message;
    this.toastEl.textContent = message;
    this.toastEl.dataset.tone = tone;
    if (message && ms) this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  private positionDraftPin(): void {
    const p = this.draft && !this.draft.id ? this.viewer.project(this.draft.position) : null;
    this.draftPin.hidden = !p;
    if (p) this.draftPin.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  }

  private panelCard(id: string): HTMLElement | null {
    return this.els.panel.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The area whose camera target is closest to a point: a good default for new comments. */
export function nearestHotspot(hotspots: Hotspot[], p: Vec3): Hotspot | undefined {
  let best: Hotspot | undefined;
  let bestD = Infinity;
  for (const hs of hotspots) {
    const d = dist(hs.view.target, p);
    if (d < bestD) {
      bestD = d;
      best = hs;
    }
  }
  return best;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
