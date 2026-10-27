// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../src/scene/schema';
import { PinLayer, type PinViewer } from '../src/viewer/pins';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const note = (id: string, title: string, x = 0, y = 0.5): Annotation => ({ id, title, body: '', kind: 'feature', position: [x, y, 0], createdAt: '' });
const pins = () => [...document.querySelectorAll<HTMLButtonElement>('.pin-layer .pin')];

/** A fake viewer: x < 0 is "behind the camera", screen x = 100·x, y = 100·y on a 400×200 stage. */
function setup(opts: { raycastReady?: boolean } = {}) {
  let frame = () => {};
  const occluded = new Set<number>();
  const viewer = {
    viewport: { width: 400, height: 200 },
    raycastReady: opts.raycastReady ?? true,
    onFrame: (fn: () => void) => ((frame = fn), () => {}),
    projectInto: ([x, y]: number[], out: { x: number; y: number }) => {
      if (x < 0) return false;
      out.x = x * 100;
      out.y = y * 100;
      return true;
    },
    isOccluded: vi.fn(([x]: number[]) => occluded.has(x)),
    requestRender: vi.fn(),
  };
  const onSelect = vi.fn();
  const layer = new PinLayer(viewer as unknown as PinViewer, document.body, onSelect);
  return { layer, viewer, onSelect, occluded, frame: () => frame() };
}

describe('PinLayer', () => {
  it('creates numbered, labelled pins, removes stale ones and asks for a frame to place them', () => {
    const { layer, viewer } = setup();
    layer.setAnnotations([note('a', 'Fork'), note('b', 'Saddle')]);
    expect(pins().map((p) => p.textContent)).toEqual(['1', '2']);
    expect(pins()[1].getAttribute('aria-label')).toBe('Comment 2: Saddle');
    expect(pins()[0].dataset.kind).toBe('feature');
    expect(viewer.requestRender).toHaveBeenCalled();
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

  it('follows projected points each frame, hides pins behind the camera or off screen and flags occluded ones', () => {
    const { layer, frame, occluded } = setup();
    layer.setAnnotations([note('a', 'A', 1), note('b', 'B', -1), note('c', 'C', 2), note('d', 'D', 9)]);
    occluded.add(2);
    frame();
    expect(pins()[0].style.transform).toBe('translate3d(100.0px, 50.0px, 0) translate(-50%, -50%)');
    expect(pins()[1].classList.contains('offscreen')).toBe(true);
    expect(pins()[3].classList.contains('offscreen')).toBe(true); // x = 900 px on a 400 px stage
    expect(pins()[2].classList.contains('occluded')).toBe(true);
    expect(pins()[0].classList.contains('occluded')).toBe(false);
    expect(pins()[0].classList.contains('offscreen')).toBe(false);
  });

  it('writes styles only when something changed', () => {
    const { layer, frame } = setup();
    layer.setAnnotations([note('a', 'A', 1)]);
    frame();
    const el = pins()[0];
    // A sentinel only survives if the layer does not rewrite an unchanged position.
    el.style.transform = 'none';
    const toggle = vi.spyOn(el.classList, 'toggle');
    frame();
    frame();
    expect(el.style.transform).toBe('none');
    expect(toggle).not.toHaveBeenCalled();
    layer.setAnnotations([note('a', 'A', 1.5)]);
    frame();
    expect(el.style.transform).toContain('150.0px');
  });

  it('brings a pin back when it returns on screen', () => {
    const { layer, frame } = setup();
    layer.setAnnotations([note('a', 'A', -1)]);
    frame();
    expect(pins()[0].classList.contains('offscreen')).toBe(true);
    layer.setAnnotations([note('a', 'A', 1)]);
    frame();
    expect(pins()[0].classList.contains('offscreen')).toBe(false);
    expect(pins()[0].style.transform).toContain('100.0px');
  });

  it('spends at most the time budget on occlusion per frame and finishes on idle animation frames', () => {
    const { layer, viewer, frame } = setup();
    const many = Array.from({ length: 50 }, (_, i) => note(`n${i}`, `N${i}`, 1 + i / 100));
    layer.setAnnotations(many);
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // Every raycast "takes" 1 ms against a 3 ms budget.
    viewer.isOccluded.mockImplementation(() => ((clock += 1), false));
    const raf: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => raf.push(cb));
    frame();
    expect(viewer.isOccluded.mock.calls.length).toBeLessThanOrEqual(5);
    expect(raf).toHaveLength(1);
    // Idle frames (no render) keep testing until every pin is current, then stop asking.
    for (let i = 0; raf.length && i < 100; i++) raf.shift()!(0);
    expect(viewer.isOccluded).toHaveBeenCalledTimes(50);
    expect(raf).toHaveLength(0);
    // A new view (drawn frame) makes them stale again.
    frame();
    expect(viewer.isOccluded.mock.calls.length).toBeGreaterThan(50);
  });

  it('skips occlusion tests for off-screen pins and while raycasts are not cheap yet', () => {
    const slow = setup({ raycastReady: false });
    slow.layer.setAnnotations([note('a', 'A', 1)]);
    slow.frame();
    expect(slow.viewer.isOccluded).not.toHaveBeenCalled();
    document.body.replaceChildren();

    const { layer, viewer, frame } = setup();
    layer.setAnnotations([note('a', 'A', -1), note('b', 'B', 1)]);
    frame();
    expect(viewer.isOccluded).toHaveBeenCalledTimes(1);
    expect(viewer.isOccluded.mock.calls[0][0]).toEqual([1, 0.5, 0]);
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
