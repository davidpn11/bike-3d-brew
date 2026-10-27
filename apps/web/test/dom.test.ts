// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../src/scene/schema';
import { download, h } from '../src/ui/dom';
import { PinLayer } from '../src/viewer/pins';
import type { Viewer } from '../src/viewer/Viewer';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('h()', () => {
  it('sets classes, data, attributes, properties, listeners and children', () => {
    const onclick = vi.fn();
    const el = h('button', { class: 'a b', dataset: { id: 'x' }, type: 'button', 'aria-label': 'Go', disabled: true, hidden: false, title: undefined, onclick }, 'Go ', h('small', {}, '3'), null, false);
    expect(el.className).toBe('a b');
    expect(el.dataset.id).toBe('x');
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(el.disabled).toBe(true);
    expect(el.hidden).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.textContent).toBe('Go 3');
    el.click(); // disabled: no click
    el.disabled = false;
    el.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('sets non-string values as properties (e.g. selected options)', () => {
    const select = h('select', {}, h('option', { value: 'a' }, 'A'), h('option', { value: 'b', selected: true }, 'B'));
    expect(select.value).toBe('b');
  });
});

describe('download()', () => {
  it('clicks a temporary link to the blob and revokes it later', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    download('bike.json', '{"a":1}');
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((create.mock.calls[0][0] as Blob).type).toBe('application/json');
    expect(clicked[0].download).toBe('bike.json');
    expect(clicked[0].href).toBe('blob:test');
    expect(document.querySelector('a')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    vi.useRealTimers();
  });

  it('passes Blobs through untouched', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:png');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const png = new Blob([new Uint8Array([1])], { type: 'image/png' });
    download('bike.png', png);
    expect(create).toHaveBeenCalledWith(png);
  });
});

describe('PinLayer', () => {
  const note = (id: string, title: string, x = 0): Annotation => ({ id, title, body: '', kind: 'feature', position: [x, 0, 0], createdAt: '' });

  function setup() {
    let frame = () => {};
    const occluded = new Set<number>();
    const viewer = {
      onFrame: (fn: () => void) => ((frame = fn), () => {}),
      // x < 0 is "behind the camera".
      project: ([x]: number[]) => (x < 0 ? null : { x: x * 100, y: 50 }),
      isOccluded: ([x]: number[]) => occluded.has(x),
    } as unknown as Viewer;
    const onSelect = vi.fn();
    const layer = new PinLayer(viewer, document.body, onSelect);
    return { layer, onSelect, occluded, frame: () => frame() };
  }
  const pins = () => [...document.querySelectorAll<HTMLButtonElement>('.pin-layer .pin')];

  it('creates numbered, labelled pins and removes stale ones', () => {
    const { layer } = setup();
    layer.setAnnotations([note('a', 'Fork'), note('b', 'Saddle')]);
    expect(pins().map((p) => p.textContent)).toEqual(['1', '2']);
    expect(pins()[1].getAttribute('aria-label')).toBe('Comment 2: Saddle');
    expect(pins()[0].dataset.kind).toBe('feature');
    layer.setAnnotations([note('b', 'Saddle')]);
    expect(pins()).toHaveLength(1);
    expect(pins()[0].textContent).toBe('1');
  });

  it('marks the active pin and dims pins outside the filter', () => {
    const { layer } = setup();
    layer.setAnnotations([note('a', 'A'), note('b', 'B')]);
    layer.setActive('b');
    layer.filter(['a']);
    expect(pins()[1].classList.contains('active')).toBe(true);
    expect(pins()[1].classList.contains('filtered')).toBe(true);
    expect(pins()[0].classList.contains('filtered')).toBe(false);
    layer.filter(null);
    expect(pins()[1].classList.contains('filtered')).toBe(false);
  });

  it('follows projected points each frame, hides pins behind the camera and flags occluded ones', () => {
    const { layer, frame, occluded } = setup();
    layer.setAnnotations([note('a', 'A', 1), note('b', 'B', -1), note('c', 'C', 2)]);
    occluded.add(2);
    frame();
    expect(pins()[0].style.transform).toContain('translate(100px, 50px)');
    expect(pins()[1].style.display).toBe('none');
    expect(pins()[2].classList.contains('occluded')).toBe(true);
    expect(pins()[0].classList.contains('occluded')).toBe(false);
  });

  it('selects on click without letting the click reach the canvas', () => {
    const { layer, onSelect } = setup();
    const canvasClick = vi.fn();
    document.body.addEventListener('click', canvasClick);
    layer.setAnnotations([note('a', 'A')]);
    pins()[0].click();
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(canvasClick).not.toHaveBeenCalled();
  });
});
