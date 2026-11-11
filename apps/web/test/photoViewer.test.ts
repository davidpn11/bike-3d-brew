// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankedPhoto } from '../src/scene/photos';
import type { PhotoLibrary } from '../src/ui/photoLibrary';
import { Lightbox, filmstrip } from '../src/ui/photoViewer';

const photos: RankedPhoto[] = ['images/IMG_0001.HEIC', 'images/IMG_0002.HEIC', 'images/IMG_0003.HEIC'].map((path, i) => ({ sample: i, path, score: 1 - i / 10, angleDeg: 5, distance: 0.5 }) as RankedPhoto);

/** A library whose photos resolve when the test says so. */
function fakeLib(available: (path: string, size: string) => boolean = () => true) {
  const errors = new Map<string, string>();
  const get = vi.fn(async (path: string, size: string) => (available(path, size) ? `blob:${size}:${path}` : null));
  return { lib: { get, errors, hasZip: true } as unknown as PhotoLibrary, get, errors };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  // happy-dom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture ??= () => {};
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('filmstrip', () => {
  it('shows one labelled tile per photo and fills thumbnails in as they decode', async () => {
    const { lib, errors } = fakeLib((p) => !p.endsWith('2.HEIC'));
    errors.set('images/IMG_0002.HEIC', 'Could not decode HEIC: bad file');
    const onOpen = vi.fn();
    const strip = filmstrip(photos, lib, onOpen, 'Fork');
    document.body.append(strip);
    expect(strip.getAttribute('aria-label')).toBe('Close-up photos: Fork');
    const tiles = [...strip.querySelectorAll('button')];
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Photo 1 of 3: Fork', 'Photo 2 of 3: Fork', 'Photo 3 of 3: Fork']);
    expect(tiles[0].title).toBe('IMG_0001.HEIC');
    expect(tiles.every((t) => t.classList.contains('loading'))).toBe(true);
    await flush();
    expect(tiles[0].querySelector('img')!.getAttribute('src')).toBe('blob:thumb:images/IMG_0001.HEIC');
    expect(tiles[1].classList.contains('missing')).toBe(true);
    expect(tiles[1].title).toBe('Could not decode HEIC: bad file');
    expect(tiles.some((t) => t.classList.contains('loading'))).toBe(false);
    tiles[2].click();
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it('explains a photo that is simply not stored', async () => {
    const { lib } = fakeLib(() => false);
    const strip = filmstrip(photos.slice(0, 1), lib, () => {}, 'Fork');
    await flush();
    expect(strip.querySelector('button')!.title).toBe('IMG_0001.HEIC is not stored in this browser');
  });
});

describe('Lightbox', () => {
  function open(index = 0, available?: (path: string, size: string) => boolean) {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const box = new Lightbox();
    const { lib, get, errors } = fakeLib(available);
    box.open(photos, index, lib, 'Cockpit');
    const q = <T extends Element>(s: string) => box.el.querySelector<T>(s)!;
    return { box, get, errors, trigger, img: q<HTMLImageElement>('.lb-stage img'), stage: q<HTMLElement>('.lb-stage'), counter: q('.count'), caption: q('.caption'), status: q<HTMLElement>('.status') };
  }

  it('opens on the chosen photo with focus on close, and warms up the neighbours', async () => {
    const { box, get, img, counter, caption, status } = open(1);
    expect(box.isOpen).toBe(true);
    expect(box.el.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(box.el.querySelector('.lb-close'));
    expect(counter.textContent).toBe('2 / 3');
    expect(caption.textContent).toBe('Cockpit · IMG_0002.HEIC');
    expect(status.textContent).toBe('Loading photo…');
    await flush();
    expect(img.getAttribute('src')).toBe('blob:full:images/IMG_0002.HEIC');
    expect(status.hidden).toBe(true);
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual(photos.map((p) => p.path).sort());
  });

  it('steps with keys and buttons, wrapping around, and closes with Esc, restoring focus', async () => {
    const { box, counter, trigger } = open(0);
    const key = (k: string) => box.handleKey(new KeyboardEvent('keydown', { key: k }));
    expect(key('ArrowLeft')).toBe(true);
    expect(counter.textContent).toBe('3 / 3');
    expect(key('ArrowRight')).toBe(true);
    expect(counter.textContent).toBe('1 / 3');
    (box.el.querySelector('.lb-nav.next') as HTMLElement).click();
    expect(counter.textContent).toBe('2 / 3');
    (box.el.querySelector('.lb-nav.prev') as HTMLElement).click();
    expect(counter.textContent).toBe('1 / 3');
    expect(key(' ')).toBe(true); // swallowed so the page does not scroll
    expect(key('a')).toBe(false);
    expect(key('Escape')).toBe(true);
    expect(box.isOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(key('ArrowRight')).toBe(false); // closed: keys go to the app
    (box.el.querySelector('.lb-close') as HTMLElement).click();
    expect(box.isOpen).toBe(false);
  });

  it('says why a photo cannot be shown', async () => {
    const { status, errors, box } = open(0, (p) => p.endsWith('3.HEIC'));
    await flush();
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/not stored in this browser\. Drop the \.bikecapture\.zip again/);
    errors.set('images/IMG_0002.HEIC', 'Could not decode HEIC: bad file');
    box.go(1);
    await flush();
    expect(status.textContent).toBe('Could not decode HEIC: bad file');
  });

  it('ignores a photo that arrives after the user moved on', async () => {
    const box = new Lightbox();
    let release: (u: string) => void = () => {};
    const lib = { get: vi.fn((path: string) => (path.endsWith('1.HEIC') ? new Promise((r) => (release = r)) : Promise.resolve(`blob:${path}`))), errors: new Map() } as unknown as PhotoLibrary;
    box.open(photos, 0, lib, 'Fork');
    box.go(1);
    await flush();
    release('blob:late');
    await flush();
    expect(box.el.querySelector('.lb-stage img')!.getAttribute('src')).toBe('blob:images/IMG_0002.HEIC');
  });

  it('a single photo does not warm itself up twice', () => {
    const box = new Lightbox();
    const { lib, get } = fakeLib();
    box.open(photos.slice(0, 1), 0, lib, 'Fork');
    expect(get).toHaveBeenCalledTimes(1);
    box.go(1);
    expect(box.el.querySelector('.count')!.textContent).toBe('1 / 1');
  });

  describe('gestures', () => {
    const pointer = (el: HTMLElement, type: string, id: number, x: number, y = 100) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }));

    it('swipes to the next and previous photo', () => {
      const { stage, counter } = open(0);
      pointer(stage, 'pointerdown', 1, 300);
      pointer(stage, 'pointermove', 1, 200);
      pointer(stage, 'pointerup', 1, 200);
      expect(counter.textContent).toBe('2 / 3');
      pointer(stage, 'pointerdown', 1, 100);
      pointer(stage, 'pointermove', 1, 220);
      pointer(stage, 'pointerup', 1, 220);
      expect(counter.textContent).toBe('1 / 3');
      // Mostly vertical or short drags do nothing.
      pointer(stage, 'pointerdown', 1, 100, 100);
      pointer(stage, 'pointermove', 1, 160, 300);
      pointer(stage, 'pointerup', 1, 160, 300);
      expect(counter.textContent).toBe('1 / 3');
    });

    it('double-tap zooms in and out; dragging pans while zoomed', () => {
      const { stage, box, img, counter } = open(0);
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      pointer(stage, 'pointerdown', 1, 100);
      pointer(stage, 'pointerup', 1, 100);
      vi.spyOn(performance, 'now').mockReturnValue(1200);
      pointer(stage, 'pointerdown', 1, 100);
      pointer(stage, 'pointerup', 1, 100);
      expect(box.el.classList.contains('zoomed')).toBe(true);
      expect(img.style.transform).toContain('scale(2.5)');
      // Drag pans instead of swiping while zoomed.
      pointer(stage, 'pointerdown', 1, 100);
      pointer(stage, 'pointermove', 1, 300);
      pointer(stage, 'pointerup', 1, 300);
      expect(counter.textContent).toBe('1 / 3');
      expect(img.style.transform).toBe('translate(200px, 0px) scale(2.5)');
      // A slow second tap is a new first tap, not a double tap.
      vi.spyOn(performance, 'now').mockReturnValue(5000);
      pointer(stage, 'pointerdown', 1, 300);
      pointer(stage, 'pointerup', 1, 300);
      expect(box.el.classList.contains('zoomed')).toBe(true);
      vi.spyOn(performance, 'now').mockReturnValue(5100);
      pointer(stage, 'pointerdown', 1, 300);
      pointer(stage, 'pointerup', 1, 300);
      expect(box.el.classList.contains('zoomed')).toBe(false);
      expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('pinches to zoom with two pointers, clamped to 5x, and the wheel zooms too', () => {
      const { stage, box, img } = open(0);
      pointer(stage, 'pointerdown', 1, 100);
      pointer(stage, 'pointerdown', 2, 200);
      pointer(stage, 'pointermove', 2, 400); // spread 100 → 300: 3x
      expect(img.style.transform).toContain('scale(3)');
      pointer(stage, 'pointermove', 2, 1000); // way past the limit
      expect(img.style.transform).toContain('scale(5)');
      pointer(stage, 'pointerup', 2, 1000); // one finger left: keeps zoom, re-anchors
      pointer(stage, 'pointermove', 9, 50); // unknown pointer: ignored
      pointer(stage, 'pointercancel', 1, 100);
      expect(box.el.classList.contains('zoomed')).toBe(true);
      pointer(stage, 'pointerup', 7, 0); // never went down: ignored

      const wheel = new WheelEvent('wheel', { deltaY: 10_000, cancelable: true });
      stage.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(box.el.classList.contains('zoomed')).toBe(false);
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, cancelable: true }));
      expect(img.style.transform).toMatch(/scale\(1\.4/);
    });

    it('a new photo resets the zoom', () => {
      const { stage, box, img } = open(0);
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true }));
      expect(box.el.classList.contains('zoomed')).toBe(true);
      box.go(1);
      expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
    });
  });
});
