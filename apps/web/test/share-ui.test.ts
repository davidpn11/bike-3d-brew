// @vitest-environment happy-dom
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Annotation, type BikeScene, SCHEMA } from '../src/scene/schema';
import type { ShareOption } from '../src/scene/share';
import { markdownBlock } from '../src/ui/markdown';
import { PresentView } from '../src/ui/present';
import { dragReorder } from '../src/ui/reorder';
import { ShareDialog } from '../src/ui/share';
import { LeaderLayer } from '../src/viewer/leaders';
import type { Viewer } from '../src/viewer/Viewer';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeViewer() {
  const frames: (() => void)[] = [];
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const modelRoot = new THREE.Group();
  modelRoot.updateMatrixWorld();
  const viewer = { camera, modelRoot, renderer: { domElement: { clientWidth: 200, clientHeight: 100 } }, onFrame: (fn: () => void) => frames.push(fn) };
  return { viewer: viewer as unknown as Viewer, frame: () => frames.forEach((f) => f()), camera };
}

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return { top, height, bottom: top + height, left, width, right: left + width, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe('markdownBlock', () => {
  it('builds paragraphs, breaks, lists and emphasis as DOM nodes', () => {
    const el = markdownBlock('Hi **there** *you*\nline two\n\n- one\n- **two**');
    expect(el.className).toBe('md');
    expect(el.innerHTML).toBe('<p>Hi <strong>there</strong> <em>you</em><br>line two</p><ul><li>one</li><li><strong>two</strong></li></ul>');
  });

  it('never turns comment text into markup', () => {
    const el = markdownBlock('<img src=x onerror="alert(1)"> **<script>alert(2)</script>** [x](javascript:alert(3)) <a href="javascript:x">y</a>');
    expect(el.querySelector('img, script, a, iframe')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)"> <script>alert(2)</script> [x](javascript:alert(3)) <a href="javascript:x">y</a>');
    expect(el.querySelectorAll('*').length).toBe(2); // <p> and <strong>
  });
});

describe('dragReorder', () => {
  function list(n: number) {
    const ol = document.createElement('ol');
    for (let i = 0; i < n; i++) {
      const li = document.createElement('li');
      li.dataset.id = `c${i}`;
      li.innerHTML = '<span class="drag">⋮⋮</span><span class="title">x</span>';
      vi.spyOn(li, 'getBoundingClientRect').mockReturnValue(rect(i * 50, 40));
      ol.append(li);
    }
    document.body.append(ol);
    return ol;
  }
  const pointer = (type: string, y: number, button = 0) => new PointerEvent(type, { bubbles: true, cancelable: true, clientY: y, clientX: 5, button, pointerId: 1 });

  it('drags an item by its handle to a new index', () => {
    const ol = list(4);
    const onDrop = vi.fn();
    dragReorder(ol, '.drag', onDrop);
    const handle = ol.children[0].querySelector('.drag')!;
    handle.dispatchEvent(pointer('pointerdown', 20));
    expect(ol.classList.contains('reordering')).toBe(true);
    handle.dispatchEvent(pointer('pointermove', 125));
    expect((ol.children[0] as HTMLElement).style.transform).toBe('translateY(105px)');
    expect((ol.children[1] as HTMLElement).style.transform).toBe('translateY(-50px)');
    expect((ol.children[2] as HTMLElement).style.transform).toBe('translateY(-50px)');
    expect((ol.children[3] as HTMLElement).style.transform).toBe('');
    handle.dispatchEvent(pointer('pointerup', 125));
    expect(onDrop).toHaveBeenCalledWith('c0', 2);
    expect(ol.classList.contains('reordering')).toBe(false);
    expect((ol.children[1] as HTMLElement).style.transform).toBe('');
    // The click that follows a drag does not reach the item.
    const click = vi.fn();
    ol.children[0].addEventListener('click', click);
    (ol.children[0] as HTMLElement).click();
    expect(click).not.toHaveBeenCalled();
  });

  it('moves items down to make room when dragging up; cancel and no-op drops do nothing', () => {
    const ol = list(3);
    const onDrop = vi.fn();
    dragReorder(ol, '.drag', onDrop);
    const handle = ol.children[2].querySelector('.drag')!;
    handle.dispatchEvent(pointer('pointerdown', 120));
    handle.dispatchEvent(pointer('pointermove', 10));
    expect((ol.children[0] as HTMLElement).style.transform).toBe('translateY(50px)');
    expect((ol.children[1] as HTMLElement).style.transform).toBe('translateY(50px)');
    handle.dispatchEvent(pointer('pointercancel', 10));
    expect(onDrop).not.toHaveBeenCalled();
    handle.dispatchEvent(pointer('pointerdown', 120));
    handle.dispatchEvent(pointer('pointerup', 121));
    expect(onDrop).not.toHaveBeenCalled();
    // Not on a handle, or not the primary button: ignored.
    ol.children[0].querySelector('.title')!.dispatchEvent(pointer('pointerdown', 10));
    ol.children[0].querySelector('.drag')!.dispatchEvent(pointer('pointerdown', 10, 2));
    expect(ol.classList.contains('reordering')).toBe(false);
  });

  it('ignores handles outside a direct list item', () => {
    const ol = document.createElement('ol');
    ol.innerHTML = '<div><li data-id="x"><span class="drag"></span></li></div>';
    document.body.append(ol);
    dragReorder(ol, '.drag', vi.fn());
    ol.querySelector('.drag')!.dispatchEvent(pointer('pointerdown', 0));
    expect(ol.classList.contains('reordering')).toBe(false);
    const ol2 = document.createElement('ol');
    ol2.innerHTML = '<span class="drag"></span>';
    document.body.append(ol2);
    dragReorder(ol2, '.drag', vi.fn());
    ol2.querySelector('.drag')!.dispatchEvent(pointer('pointerdown', 0));
    expect(ol2.classList.contains('reordering')).toBe(false);
  });
});

const scene: BikeScene = {
  schema: SCHEMA,
  id: 'demo-road',
  name: 'Demo Road Bike',
  model: { url: 'demo:road', format: 'demo' },
  background: 'studio',
  hotspots: [{ id: 'hs-fork', name: 'Fork', view: { position: [1, 1, 1], target: [0, 0, 0] } }],
  annotations: [],
};

describe('ShareDialog', () => {
  const link: ShareOption = { kind: 'link', url: 'https://shop.example/app/?scene=scenes/demo/scene.bike.json&view=present', stale: false };
  const ctx = (option: ShareOption, over: Partial<Parameters<ShareDialog['open']>[0]> = {}) => ({
    option,
    sceneName: 'Demo',
    packageInput: async () => ({ scene }),
    toast: vi.fn(),
    ...over,
  });

  it('copies the customer link and shows it', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, share: undefined });
    const dialog = new ShareDialog();
    await dialog.share(ctx(link));
    expect(dialog.isOpen).toBe(true);
    await flush();
    expect(writeText).toHaveBeenCalledWith(link.url);
    expect(dialog.el.querySelector<HTMLInputElement>('.share-url')!.value).toBe(link.url);
    expect(dialog.el.querySelector('.share-status')!.textContent).toMatch(/Link copied/);
    expect(dialog.el.querySelector('.share-warn')).toBeNull();
    expect(dialog.el.querySelector('a.button')!.getAttribute('href')).toBe(link.url);
    expect([...dialog.el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['×', 'Copy link', 'Export share package']);
    dialog.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.isOpen).toBe(false);
    dialog.close();
  });

  it('falls back to the visible field when copying is blocked, and warns about local edits', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) }, share: undefined });
    const dialog = new ShareDialog();
    dialog.open(ctx({ ...link, stale: true }));
    await flush();
    expect(dialog.el.querySelector('.share-status')!.textContent).toMatch(/Copy the link above/);
    expect(dialog.el.querySelector('.share-warn')!.textContent).toMatch(/not in the published copy/);
    const field = dialog.el.querySelector<HTMLInputElement>('.share-url')!;
    field.dispatchEvent(new Event('focus'));
    dialog.el.dispatchEvent(new PointerEvent('pointerdown'));
    expect(dialog.isOpen).toBe(false);
  });

  it('uses the share sheet on touch devices, with a dialog fallback when it fails', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText: vi.fn(async () => {}) } });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const dialog = new ShareDialog();
    await dialog.share(ctx(link));
    expect(share).toHaveBeenCalledWith({ title: 'Demo', url: link.url });
    expect(dialog.isOpen).toBe(false);
    share.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    await dialog.share(ctx(link));
    expect(dialog.isOpen).toBe(false);
    share.mockRejectedValueOnce(new Error('not allowed'));
    await dialog.share(ctx(link));
    expect(dialog.isOpen).toBe(true);
    // The dialog offers the share sheet too.
    const sheet = [...dialog.el.querySelectorAll('button')].find((b) => b.textContent === 'Share…')!;
    sheet.click();
    expect(share).toHaveBeenCalledTimes(4);
  });

  it('explains publishing for local scenes and exports a share package', async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (created.push(b as Blob), 'blob:x'));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const toast = vi.fn();
    const dialog = new ShareDialog();
    dialog.open(ctx({ kind: 'package', reason: 'local-model' }, { toast }));
    expect(dialog.el.textContent).toMatch(/only exists in this browser/);
    const btn = [...dialog.el.querySelectorAll('button')].find((b) => b.textContent === 'Export share package')!;
    btn.click();
    expect(btn.textContent).toBe('Preparing…');
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatch(/Saved demo-road-bike\.bikeshare\.zip\. Publish it/);
    const files = unzipSync(new Uint8Array(await created[0].arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['bike-share.json', 'scene.bike.json']);
    expect(btn.textContent).toBe('Export share package');

    dialog.open(ctx({ kind: 'package', reason: 'not-published' }, { toast, packageInput: async () => ({ scene, photos: new Map([['hs-fork', [new Uint8Array([0xff, 0xd8, 0xff])]]]) }) }));
    expect(dialog.el.textContent).toMatch(/not published yet/);
    [...dialog.el.querySelectorAll('button')].find((b) => b.textContent === 'Export share package')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(toast.mock.calls[1][0]).toMatch(/with 1 photos/);

    dialog.open(ctx({ kind: 'package', reason: 'not-published' }, { toast, packageInput: async () => Promise.reject('offline') }));
    [...dialog.el.querySelectorAll('button')].find((b) => b.textContent === 'Export share package')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(3));
    expect(toast.mock.calls[2]).toEqual(['Could not export the share package: offline', 'error', 0]);
    dialog.open(ctx({ kind: 'package', reason: 'not-published' }, { toast, packageInput: async () => Promise.reject(new Error('no model')) }));
    [...dialog.el.querySelectorAll('button')].find((b) => b.textContent === 'Export share package')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(4));
    expect(toast.mock.calls[3][0]).toBe('Could not export the share package: no model');
  });
});

describe('LeaderLayer', () => {
  it('draws pooled lines from projected points to the target’s nearest edge', () => {
    const { viewer, frame, camera } = fakeViewer();
    const stage = document.createElement('div');
    document.body.append(stage);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 0, 200));
    const layer = new LeaderLayer(viewer, stage);
    const card = document.createElement('div');
    stage.append(card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(70, 30, 50, 100));
    frame(); // nothing to draw
    layer.set(
      [
        { position: [0, 0, 0], target: card, active: true },
        { position: [0, 0, 10], target: card, active: false }, // behind the camera
      ],
      card,
    );
    frame();
    const lines = layer.el.querySelectorAll('line');
    expect(lines).toHaveLength(2);
    expect([lines[0].getAttribute('x1'), lines[0].getAttribute('y1'), lines[0].getAttribute('x2'), lines[0].getAttribute('y2')]).toEqual(['100.0', '50.0', '100.0', '70.0']);
    expect(lines[0].getAttribute('class')).toBe('active');
    expect(lines[1].getAttribute('class')).toBe('off');
    // Below the card, and inside it.
    layer.set([{ position: [0, 0, 0], target: card, active: false }], card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(10, 30, 120, 60));
    card.dispatchEvent(new Event('scroll'));
    frame();
    expect([lines[0].getAttribute('x2'), lines[0].getAttribute('y2')]).toEqual(['132.0', '40.0']);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(20, 60, 0, 100));
    layer.measure();
    frame();
    expect([lines[0].getAttribute('x2'), lines[0].getAttribute('y2')]).toEqual(['88.0', '50.0']);
    expect(lines[0].getAttribute('class')).toBe('');
    expect(lines[1].getAttribute('class')).toBe('off');
    camera.position.set(0, 0, 5);
    // A collapsed target hides the line; clear() hides everything.
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(0, 0));
    layer.measure();
    frame();
    expect(lines[0].getAttribute('class')).toBe('off');
    layer.set([{ position: [0, 0, 0], target: card, active: true }], null);
    frame();
    layer.clear();
    expect([...layer.el.querySelectorAll('line')].every((l) => l.getAttribute('class') === 'off')).toBe(true);
  });
});

describe('PresentView', () => {
  const note = (id: string, over: Partial<Annotation> = {}): Annotation => ({ id, position: [0, 0, 0], title: `Title ${id}`, body: '', kind: 'feature', hotspotId: 'hs-fork', createdAt: '', ...over });

  function setup() {
    const { viewer, frame } = fakeViewer();
    const stage = document.createElement('div');
    document.body.append(stage);
    const go = vi.fn();
    const focus = vi.fn();
    const view = new PresentView(viewer, stage, { go, focus }, { interval: 1000, idle: 3000 });
    const steps = [null, scene.hotspots[0]];
    const render = (step: number, over: Partial<Parameters<PresentView['render']>[0]> = {}) =>
      view.render({ scene, steps, step, notes: step ? [note('a', { body: '**Bold** text', price: '+$5' }), note('b', { kind: 'upgrade' })] : [], active: 'a', lede: 'Brew · Aero', photos: null, ...over });
    return { view, stage, go, focus, render, frame };
  }

  it('renders the overview and an area with comments, dots and leader lines', () => {
    const { view, stage, go, focus, render, frame } = setup();
    render(0);
    expect(view.el.hidden).toBe(false);
    expect(view.el.querySelector('header small')!.textContent).toBe('1 / 2');
    expect(view.el.querySelector('header strong')!.textContent).toBe('Demo Road Bike');
    expect(view.el.querySelector('.lede')!.textContent).toBe('Brew · Aero');
    render(1, { photos: document.createElement('figure') });
    expect(view.el.querySelector('header strong')!.textContent).toBe('Fork');
    const notes = view.el.querySelectorAll('li.note');
    expect(notes).toHaveLength(2);
    expect(notes[0].classList.contains('on')).toBe(true);
    expect(notes[0].querySelector('.md strong')!.textContent).toBe('Bold');
    expect(notes[0].querySelector('.price')!.textContent).toBe('+$5');
    expect(view.el.querySelector('figure')).not.toBeNull();
    (notes[1] as HTMLElement).click();
    notes[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    notes[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(focus.mock.calls).toEqual([['b'], ['b']]);
    const dots = view.el.querySelectorAll<HTMLButtonElement>('.dots button');
    expect([...dots].map((d) => d.getAttribute('aria-label'))).toEqual(['Whole bike', 'Fork']);
    expect(dots[1].getAttribute('aria-selected')).toBe('true');
    dots[0].click();
    view.el.querySelector<HTMLButtonElement>('[aria-label="Previous area"]')!.click();
    view.el.querySelector<HTMLButtonElement>('[aria-label="Next area"]')!.click();
    expect(go.mock.calls).toEqual([[0], [0], [2]]);
    frame();
    expect(stage.querySelectorAll('.leader-layer line')).toHaveLength(2);
    expect(stage.dataset.present).toBe('on');
    render(1, { notes: [] });
    expect(view.el.querySelector('ul.notes')).toBeNull();
    view.hide();
    expect(view.el.hidden).toBe(true);
    expect(stage.style.getPropertyValue('--present-card-h')).toBe('0px');
    expect(stage.dataset.present).toBeUndefined();
  });

  it('auto-play: button, progress bar, hold on interaction', () => {
    vi.useFakeTimers();
    const { view, stage, go, render } = setup();
    render(1);
    const play = () => view.el.querySelector<HTMLButtonElement>('.play')!;
    expect(play().getAttribute('aria-pressed')).toBe('false');
    play().click();
    expect(view.kiosk.state).toBe('playing');
    expect(play().textContent).toBe('❚❚');
    expect(view.el.dataset.kiosk).toBe('playing');
    expect(view.el.querySelector('.kiosk-bar')!.classList.contains('run')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(go).toHaveBeenCalledWith(2);
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(view.kiosk.state).toBe('held');
    expect(view.el.querySelector('.kiosk-bar')!.classList.contains('run')).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(view.kiosk.state).toBe('playing');
    render(1);
    expect(play().getAttribute('aria-label')).toBe('Stop auto-play');
    play().click();
    expect(view.kiosk.state).toBe('off');
    expect(play().textContent).toBe('▶');
    view.hide();
    view.kiosk.play(); // hidden: no DOM sync
    view.kiosk.stop();
  });

  it('swipes left/right on the card change area; vertical drags and filmstrips do not', () => {
    const { view, go, render } = setup();
    const filmstrip = document.createElement('div');
    filmstrip.className = 'filmstrip';
    render(1, { photos: filmstrip });
    const ev = (type: string, x: number, y: number, id = 1) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id });
    const note = view.el.querySelector('li.note')!;
    note.dispatchEvent(ev('pointerdown', 200, 10));
    note.dispatchEvent(ev('pointerup', 100, 20));
    expect(go).toHaveBeenLastCalledWith(2);
    // The click that ends the swipe does not select the comment.
    const click = vi.fn();
    note.addEventListener('click', click);
    (note as HTMLElement).click();
    expect(click).not.toHaveBeenCalled();
    note.dispatchEvent(ev('pointerdown', 100, 10));
    note.dispatchEvent(ev('pointerup', 200, 20));
    expect(go).toHaveBeenLastCalledWith(0);
    go.mockClear();
    note.dispatchEvent(ev('pointerdown', 100, 10));
    note.dispatchEvent(ev('pointerup', 160, 200)); // mostly vertical
    note.dispatchEvent(ev('pointerdown', 100, 10));
    note.dispatchEvent(ev('pointerup', 120, 10)); // too short
    note.dispatchEvent(ev('pointerdown', 100, 10));
    note.dispatchEvent(ev('pointerup', 300, 10, 2)); // another pointer
    note.dispatchEvent(ev('pointerdown', 100, 10));
    note.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    note.dispatchEvent(ev('pointerup', 300, 10));
    filmstrip.dispatchEvent(ev('pointerdown', 300, 10));
    filmstrip.dispatchEvent(ev('pointerup', 0, 10));
    expect(go).not.toHaveBeenCalled();
  });
});
