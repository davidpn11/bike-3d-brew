// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Box } from '../src/scene/crop';
import { CropBoxEditor } from '../src/viewer/cropBox';

afterEach(() => document.body.replaceChildren());

const BOX: Box = { min: [-1, 0, -0.3], max: [1, 1, 0.3] };
const W = 800;
const H = 600;

function setup(cameraAt: [number, number, number] = [0.5, 0.5, 4], lookAt: [number, number, number] = [0, 0.5, 0]) {
  const el = document.createElement('div');
  document.body.append(el);
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  Object.defineProperty(el, 'clientHeight', { value: H });
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 100);
  camera.position.set(...cameraAt);
  if (cameraAt[1] > 3) camera.up.set(0, 0, -1); // looking straight down
  camera.lookAt(...lookAt);
  camera.updateMatrixWorld(true);
  const modelRoot = new THREE.Group();
  modelRoot.updateMatrixWorld(true);
  let frame = () => {};
  const previewCrop = vi.fn();
  const editor = new CropBoxEditor({ camera, modelRoot, scene: new THREE.Scene(), eventTarget: el, previewCrop, onFrame: (fn) => ((frame = fn), () => {}) });
  const onCommit = vi.fn();
  editor.onCommit = onCommit;
  editor.syncTransform();
  editor.setBox(BOX);
  editor.setVisible(true);
  editor.group.updateMatrixWorld(true);
  /** Client position of the handle on face `axis`/`side`. */
  const handleAt = (axis: number, side: 'min' | 'max') => {
    const p = new THREE.Vector3((BOX.min[0] + BOX.max[0]) / 2, (BOX.min[1] + BOX.max[1]) / 2, (BOX.min[2] + BOX.max[2]) / 2);
    p.setComponent(axis, BOX[side][axis]).project(camera);
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
  };
  const pointer = (type: string, at: { x: number; y: number }, extra: Partial<PointerEventInit> = {}) => {
    const e = new PointerEvent(type, { clientX: at.x, clientY: at.y, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true, ...extra });
    el.dispatchEvent(e);
    return e;
  };
  return { el, editor, previewCrop, onCommit, handleAt, pointer, frame: () => frame(), camera };
}

describe('CropBoxEditor', () => {
  it('drags the top face up along its axis, previewing live and committing once on release', () => {
    const { editor, previewCrop, onCommit, handleAt, pointer } = setup();
    const bubbled = vi.fn();
    document.body.addEventListener('pointerdown', bubbled);
    const top = handleAt(1, 'max');
    const down = pointer('pointerdown', top);
    expect(down.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled(); // OrbitControls / tap-to-pin never see it
    expect(editor.dragging).toBe(true);
    editor.setBox({ min: [0, 0, 0], max: [1, 1, 1] }); // store echo during the drag is ignored
    pointer('pointermove', { x: top.x, y: top.y - 60 });
    expect(previewCrop).toHaveBeenCalledTimes(1);
    const live = previewCrop.mock.calls[0][0] as Box;
    expect(live.max[1]).toBeGreaterThan(1.1);
    expect(live.min).toEqual(BOX.min);
    pointer('pointermove', { x: top.x, y: top.y + 60 }, { pointerId: 2 }); // another finger: ignored
    expect(previewCrop).toHaveBeenCalledTimes(1);
    pointer('pointerup', { x: top.x, y: top.y - 60 }, { pointerId: 2 });
    expect(onCommit).not.toHaveBeenCalled();
    pointer('pointerup', { x: top.x, y: top.y - 60 });
    expect(onCommit).toHaveBeenCalledWith(live);
    expect(editor.dragging).toBe(false);
  });

  it('moves the min face and never lets it cross the opposite one (touch, generous hit radius)', () => {
    const { previewCrop, handleAt, pointer, onCommit } = setup();
    const left = handleAt(0, 'min');
    pointer('pointerdown', { x: left.x + 25, y: left.y }, { pointerType: 'touch' });
    pointer('pointermove', { x: W, y: left.y }, { pointerType: 'touch' });
    const box = previewCrop.mock.calls[0][0] as Box;
    expect(box.min[0]).toBeLessThan(box.max[0]);
    expect(box.min[0]).toBeGreaterThan(0.9);
    pointer('pointercancel', { x: W, y: left.y }, { pointerType: 'touch' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('ignores presses off the handles, right clicks, and everything while hidden', () => {
    const { editor, handleAt, pointer, previewCrop } = setup();
    expect(pointer('pointerdown', { x: 5, y: 5 }).defaultPrevented).toBe(false);
    expect(pointer('pointerdown', handleAt(1, 'max'), { button: 2 }).defaultPrevented).toBe(false);
    pointer('pointermove', { x: 10, y: 10 });
    pointer('pointerup', { x: 10, y: 10 });
    editor.setVisible(false);
    expect(editor.group.visible).toBe(false);
    expect(pointer('pointerdown', handleAt(1, 'max')).defaultPrevented).toBe(false);
    editor.setVisible(true);
    editor.setBox(null);
    expect(editor.group.visible).toBe(false);
    expect(pointer('pointerdown', handleAt(1, 'max')).defaultPrevented).toBe(false);
    expect(previewCrop).not.toHaveBeenCalled();
  });

  it('skips handles behind the camera and drags that would run along the view axis', () => {
    // Camera straight above the box: the top handle's axis points at the camera.
    const { handleAt, pointer, previewCrop, editor } = setup([0, 6, 0.0001]);
    const top = handleAt(1, 'max');
    pointer('pointerdown', top);
    expect(editor.dragging).toBe(true);
    pointer('pointermove', { x: top.x + 1, y: top.y }); // ray almost parallel to the face's axis
    expect(previewCrop).not.toHaveBeenCalled();
    pointer('pointerup', top);
    // Camera just in front of the box, looking away from it: every handle is behind the camera
    // (the nearest one would project onto the screen centre) and must not be hit.
    const away = setup([0, 0.5, 0.35], [0, 0.5, 10]);
    away.pointer('pointerdown', { x: W / 2, y: H / 2 });
    expect(away.editor.dragging).toBe(false);
  });

  it('keeps handles a constant size on screen', () => {
    const { editor, frame, camera } = setup();
    frame();
    const handles = editor.group.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    const near = handles.map((h) => h.scale.x);
    camera.position.multiplyScalar(2);
    frame();
    handles.forEach((h, i) => expect(h.scale.x).toBeGreaterThan(near[i] * 1.5));
    editor.setVisible(false);
    camera.position.multiplyScalar(2);
    const hidden = handles[0].scale.x;
    frame();
    expect(handles[0].scale.x).toBe(hidden);
  });
});
