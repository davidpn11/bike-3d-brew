import { viewForPoint } from '../scene/camera';
import { type CaptureBundle, bundleNameOf, captureModelRef, looksLikeZip, readCaptureBundle, sceneFromCapture } from '../scene/capture';
import { captureSummary, dataUrlToBytes, distance, nearestHotspot, presentLede, resolveModelUrl, slugify, wrapStep } from '../scene/helpers';
import { type CachedCapture, type CaptureCache, formatBytes } from '../scene/captureCache';
import { type RankTarget, type RankedPhoto, rankPhotos } from '../scene/photos';
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
import { requestPersistence } from '../storage/backends';
import { sourceToModelRoot } from '../viewer/captureSpace';
import { centerOnGround, loadModel, loadWarnings } from '../viewer/loaders';
import { PinLayer } from '../viewer/pins';
import type { Viewer } from '../viewer/Viewer';
import { download, h } from './dom';
import { PhotoLibrary } from './photoLibrary';
import { Lightbox, filmstrip } from './photoViewer';

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
  /** The last capture bundle opened; its poses and image list feed the photo close-ups. */
  capture: CaptureBundle | null = null;
  /** Bundles kept in browser storage so capture scenes survive reloads (newest first). */
  storedCaptures: CachedCapture[] = [];
  private openMenu = false;
  /** Photos of the open capture (`captureUrl`), and the matrix from pose space into model-root space. */
  private photos: PhotoLibrary | null = null;
  private captureUrl = '';
  private captureSpace: number[] | null = null;
  private rankCache = new Map<string, RankedPhoto[]>();
  private lightbox = new Lightbox();

  constructor(
    private store: SceneStore,
    private viewer: Viewer,
    private els: AppElements,
    private baseUrl: string,
    /** Null when the browser offers no usable storage; captures then need re-dropping after a reload. */
    private cache: Promise<CaptureCache | null> = Promise.resolve(null),
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
    void this.refreshStored();
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
    let url = this.resolveModelUrl(ref);
    // A capture scene after a reload: its bundle may be in browser storage.
    const restored = !url && bundleNameOf(ref.url) ? await this.loadFromCache(ref.url, this.store.scene.id) : null;
    if (restored) url = this.resolveModelUrl(ref);
    if (!url) {
      const bundle = bundleNameOf(ref.url);
      this.toast(bundle ? `Drop “${bundle}” onto the viewer to reopen this capture.` : `Model “${ref.url}” is not loaded. Drop the file onto the viewer to reopen it.`, 'error', 0);
      return;
    }
    this.toast('Loading model…', 'info', 0);
    try {
      const object = await loadModel(url, ref.format);
      this.viewer.setModel(centerOnGround(object), ref);
      this.loadedModelKey = key;
      this.captureSpace = ref.url === this.captureUrl ? sourceToModelRoot(this.viewer.modelRoot) : null;
      this.rankCache.clear();
      this.render();
      this.modelWarnings = loadWarnings(object);
      if (this.modelWarnings.length) this.toast(this.modelWarnings.join(' '), 'error', 8000);
      else this.toast(restored ? `Reopened “${restored.manifest.name}” from this browser’s storage.` : '');
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
    const radius = hotspot ? distance(hotspot.view.position, hotspot.view.target) * 0.75 : 0.6;
    await this.viewer.flyTo(viewForPoint(a.position, a.normal, this.viewer.getView().position, Math.max(0.25, radius)));
  }

  private presentSteps(): (Hotspot | null)[] {
    return [null, ...this.store.scene.hotspots];
  }

  goToStep(step: number): void {
    const steps = this.presentSteps();
    this.presentStep = wrapStep(step, steps.length);
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
      accept: '.zip,.glb,.gltf,.usdz,.ply,.json',
      hidden: true,
      onchange: (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) void this.openFile(file);
      },
    });
    const openTitle = 'Open an iPhone capture (.bikecapture.zip), a model (GLB, USDZ, PLY) or a scene JSON';
    const menu = h(
      'div',
      { class: 'actions' },
      h(
        'div',
        { class: 'open-menu' },
        h(
          'button',
          {
            type: 'button',
            title: openTitle,
            'aria-haspopup': this.storedCaptures.length ? 'menu' : undefined,
            'aria-expanded': this.storedCaptures.length ? String(this.openMenu) : undefined,
            // With nothing stored, Open goes straight to the file picker.
            onclick: () => (this.storedCaptures.length ? this.toggleOpenMenu() : fileInput.click()),
          },
          'Open…',
        ),
        this.openMenu && this.storedCaptures.length ? this.storedMenu(fileInput) : null,
      ),
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

  private toggleOpenMenu(open = !this.openMenu): void {
    if (this.openMenu === open) return;
    this.openMenu = open;
    this.render();
  }

  private storedMenu(fileInput: HTMLInputElement): HTMLElement {
    const current = this.store.scene.model.url;
    return h(
      'div',
      { class: 'menu', role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', class: 'menu-file', onclick: () => (this.toggleOpenMenu(false), fileInput.click()) }, 'Choose a file…'),
      h('h3', {}, 'Stored captures'),
      h(
        'ul',
        { class: 'stored' },
        ...this.storedCaptures.map((e) =>
          h(
            'li',
            { class: e.url === current ? 'on' : '' },
            h(
              'button',
              { type: 'button', role: 'menuitem', class: 'stored-open', title: e.bundleName, onclick: () => void this.openStored(e) },
              h('span', {}, e.name),
              h('small', {}, formatBytes(e.bytes)),
            ),
            h('button', { type: 'button', class: 'danger', 'aria-label': `Forget ${e.name}`, title: 'Remove from this browser', onclick: () => void this.forgetStored(e) }, '×'),
          ),
        ),
      ),
      h('p', { class: 'hint' }, 'Kept in this browser only, so captures reopen after a reload.'),
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

    const activeArea = scene.hotspots.find((x) => x.id === this.activeHotspot);
    const areaPhotos = activeArea ? this.photoStrip(activeArea.name, this.areaTarget(activeArea)) : null;
    if (areaPhotos) sections.push(h('section', { class: 'photos' }, h('h2', {}, `${activeArea!.name} photos`), areaPhotos));

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
        a.id === this.activeAnnotation ? this.photoStrip(a.title || 'Comment', { point: a.position, side: a.normal }) : null,
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
      : h('p', { class: 'lede' }, presentLede(scene));
    this.presentEl.replaceChildren(
      h(
        'header',
        {},
        h('button', { type: 'button', 'aria-label': 'Previous area', onclick: () => this.goToStep(this.presentStep - 1) }, '‹'),
        h('div', {}, h('small', {}, `${this.presentStep + 1} / ${steps.length}`), h('strong', {}, hotspot ? hotspot.name : scene.name)),
        h('button', { type: 'button', 'aria-label': 'Next area', onclick: () => this.goToStep(this.presentStep + 1) }, '›'),
      ),
      details,
      hotspot ? (this.photoStrip(hotspot.name, this.areaTarget(hotspot)) ?? '') : '',
    );
  }

  // ---------------------------------------------------------------- photo close-ups

  /** An area's target, seen from the side its saved camera view looks from. */
  private areaTarget(hs: Hotspot): RankTarget {
    const { position: p, target: t } = hs.view;
    return { point: t, side: [p[0] - t[0], p[1] - t[1], p[2] - t[2]] };
  }

  /** Capture photos that best show a point, as a filmstrip; null when there is nothing to show. */
  private photoStrip(label: string, target: RankTarget): HTMLElement | null {
    const capture = this.capture;
    const lib = this.photos;
    if (!capture?.poses || !lib || !this.captureSpace || this.store.scene.model.url !== this.captureUrl) return null;
    const key = JSON.stringify(target);
    let ranked = this.rankCache.get(key);
    if (!ranked) {
      ranked = rankPhotos(capture.poses.samples, capture.images, target, { toModel: this.captureSpace, limit: 8 });
      this.rankCache.set(key, ranked);
    }
    if (!ranked.length) return null;
    const photos = ranked;
    const strip = filmstrip(photos, lib, (i) => this.lightbox.open(photos, i, lib, label), label);
    if (lib.hasZip) return strip;
    const bundle = bundleNameOf(this.captureUrl);
    return h('div', { class: 'photo-block' }, strip, h('p', { class: 'hint' }, `Photos kept in this browser. Drop “${bundle}” to load any others.`));
  }

  /** Points the photo close-ups at a capture; the zip (if any) is read lazily, photo by photo. */
  private setCapture(bundle: CaptureBundle, url: string, zip: Blob | null, stored: Promise<unknown>): void {
    this.photos?.dispose();
    this.capture = bundle;
    this.captureUrl = url;
    this.captureSpace = null;
    this.rankCache.clear();
    this.photos = new PhotoLibrary({ url, zip, root: bundle.root, cache: this.cache, stored });
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
    window.addEventListener('pointerdown', (e) => {
      if (this.openMenu && !(e.target as HTMLElement)?.closest?.('.open-menu')) this.toggleOpenMenu(false);
    });
    window.addEventListener('keydown', (e) => {
      if (this.lightbox.handleKey(e)) return e.preventDefault();
      if (e.key === 'Escape' && this.openMenu) return this.toggleOpenMenu(false);
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
    if (file.name.toLowerCase().endsWith('.zip')) {
      await this.openCapture(file);
      return;
    }
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
      this.toast('Unsupported file. Use a .bikecapture.zip, .glb, .gltf, .usdz, .ply or a .bike.json scene.', 'error');
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

  /** Opens an iOS `*.bikecapture.zip`: the model is unzipped in memory, never uploaded. */
  private async openCapture(file: File): Promise<void> {
    this.toast(`Reading “${file.name}”…`, 'info', 0);
    let bundle: CaptureBundle;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksLikeZip(bytes)) throw new Error('the file is not a zip.');
      bundle = await readCaptureBundle(bytes);
    } catch (err) {
      this.toast(`Could not open capture: ${err instanceof Error ? err.message : String(err)}`, 'error', 0);
      return;
    }
    const ref = captureModelRef(bundle, file.name);
    const previous = this.modelFiles.get(ref.url);
    if (previous) URL.revokeObjectURL(previous);
    this.modelFiles.set(ref.url, URL.createObjectURL(new Blob([bundle.model.data as BlobPart])));
    this.loadedModelKey = '';
    let markStored = () => {};
    this.setCapture(bundle, ref.url, file, new Promise<void>((resolve) => (markStored = resolve)));

    // Re-dropping a bundle brings back the comments saved for it; keep any model transform.
    const fresh = sceneFromCapture(bundle, file.name);
    const current = this.store.scene;
    const saved = current.id === fresh.id ? current : this.store.saved(fresh.id);
    const scene = saved ? { ...saved, model: { ...saved.model, ...ref } } : fresh;
    await this.open(scene, { frame: saved !== current });
    if (this.loadedModelKey) void this.keepCapture(bundle, ref.url, scene.id).finally(markStored);
    else markStored();
    if (this.loadedModelKey) {
      const { message, tone, ms } = captureSummary(scene.name, { ...bundle, warnings: [...bundle.warnings, ...this.modelWarnings] });
      this.toast(message, tone, ms);
    }
  }

  // ---------------------------------------------------------------- stored captures

  /** Saves a successfully opened bundle so a reload can reopen it without the zip. */
  private async keepCapture(bundle: CaptureBundle, url: string, sceneId: string): Promise<void> {
    const cache = await this.cache;
    if (!cache) return;
    requestPersistence();
    const ok = await cache.store({ url, sceneId, manifest: bundle.manifest, poses: bundle.poses, model: bundle.model, images: bundle.images });
    if (!ok) console.info(`Capture “${bundle.manifest.name}” was not kept for reloads (storage full or unavailable).`);
    await this.refreshStored();
  }

  /** Puts a cached bundle back in memory as if its zip had just been dropped. */
  private async loadFromCache(url: string, sceneId?: string): Promise<CaptureBundle | null> {
    const cache = await this.cache;
    const restored = await cache?.restore(url, sceneId);
    if (!restored) return null;
    const { entry, manifest, poses, model } = restored;
    const bundle: CaptureBundle = { manifest, poses, images: entry.images, root: '', warnings: [], model: { path: entry.modelPath, format: entry.format, data: model } };
    const previous = this.modelFiles.get(url);
    if (previous) URL.revokeObjectURL(previous);
    this.modelFiles.set(url, URL.createObjectURL(new Blob([model as BlobPart])));
    this.setCapture(bundle, url, null, Promise.resolve());
    return bundle;
  }

  private async openStored(entry: CachedCapture): Promise<void> {
    this.openMenu = false;
    const bundle = await this.loadFromCache(entry.url);
    if (!bundle) {
      this.toast(`“${entry.name}” is no longer stored. Drop “${entry.bundleName}” to open it.`, 'error', 6000);
      await this.refreshStored();
      return;
    }
    const saved = this.store.saved(entry.sceneId) ?? sceneFromCapture(bundle, entry.bundleName);
    this.loadedModelKey = '';
    await this.open({ ...saved, model: { ...saved.model, url: entry.url, format: entry.format } });
    if (this.loadedModelKey) this.toast(`Opened “${entry.name}” from this browser’s storage.`, 'info');
    await this.refreshStored();
  }

  private async forgetStored(entry: CachedCapture): Promise<void> {
    await (await this.cache)?.remove(entry.url);
    await this.refreshStored();
  }

  private async refreshStored(): Promise<void> {
    const cache = await this.cache;
    this.storedCaptures = cache ? await cache.list() : [];
    if (!this.storedCaptures.length) this.openMenu = false;
    this.render();
  }

  private resolveModelUrl(ref: ModelRef): string | null {
    return resolveModelUrl(ref, this.modelFiles, this.baseUrl, location.href);
  }

  // ---------------------------------------------------------------- helpers

  private toastTimer = 0;
  private modelWarnings: string[] = [];
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

function dataUrlToBlob(dataUrl: string): Blob {
  const { mime, bytes } = dataUrlToBytes(dataUrl);
  return new Blob([bytes as BlobPart], { type: mime });
}
