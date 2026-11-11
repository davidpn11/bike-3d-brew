// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { axisAngle, matrixFromEulerXYZ, rotationDistance } from '../src/scene/orient';
import { SCHEMA, type BikeScene, type Vec3 } from '../src/scene/schema';
import { SceneStore } from '../src/scene/store';
import { AUTO_ORIENT_NOTE, ModelTools } from '../src/ui/modelTools';
import type { Viewer } from '../src/viewer/Viewer';
import { syntheticBike } from './helpers/syntheticBike';

const scene = (): BikeScene => ({
  schema: SCHEMA,
  id: 'cap',
  name: 'Capture',
  model: { url: 'bundle:a.zip/model.usdz', format: 'usdz' },
  background: 'transparent',
  hotspots: [],
  annotations: [{ id: 'n1', position: [0.1, 0.5, 0], title: 'Pin', body: '', kind: 'note', createdAt: '' }],
});

/** A bike lying on its side: rotated 90° about X. */
function lyingBike(): Float32Array {
  const pts = syntheticBike();
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    out[i] = pts[i];
    out[i + 1] = -pts[i + 2];
    out[i + 2] = pts[i + 1];
  }
  return out;
}

function setup(points = lyingBike()) {
  const store = new SceneStore(scene());
  const viewer = {
    samplePositions: vi.fn(() => points),
    groundedOffset: vi.fn((): Vec3 => [0.1, 0.2, 0.3]),
    // 170 cm long along X (or Z once turned), whatever the rotation: enough for the length field.
    boundsWith: vi.fn((ref: { rotation?: Vec3 }) => {
      const turned = Math.abs(Math.abs(ref.rotation?.[1] ?? 0) - Math.PI / 2) < 0.01;
      const half = turned ? { x: 0.2, z: 0.85 } : { x: 0.85, z: 0.2 };
      return { isEmpty: () => false, min: { x: -half.x, y: 0, z: -half.z }, max: { x: half.x, y: 1, z: half.z } };
    }),
    applyTransform: vi.fn(),
    flyTo: vi.fn(() => Promise.resolve()),
    overviewView: vi.fn(() => ({ position: [1, 1, 1] as Vec3, target: [0, 0, 0] as Vec3 })),
  };
  const toast = vi.fn();
  const tools = new ModelTools(store, viewer as unknown as Viewer, toast);
  const panel = () => {
    const el = tools.render(store.scene);
    document.body.replaceChildren(el);
    return el;
  };
  const click = (title: string) => panel().querySelector<HTMLButtonElement>(`button[title="${title}"]`)!.click();
  const input = (name: string, value: string) => {
    const el = panel().querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    el.value = value;
    el.dispatchEvent(new Event('change'));
  };
  return { store, viewer, toast, tools, panel, click, input };
}

describe('ModelTools', () => {
  it('auto-orients a lying bike upright and grounds it in one store update', () => {
    const { store, viewer, tools } = setup();
    const updates = vi.fn();
    store.subscribe(updates);
    expect(tools.autoOrient()).toBe(true);
    expect(updates).toHaveBeenCalledTimes(1);
    const m = matrixFromEulerXYZ(store.scene.model.rotation!);
    // Undoes the 90° about X the fixture was lying with.
    expect(rotationDistance(m, axisAngle('x', -Math.PI / 2))).toBeLessThan(0.05);
    expect(store.scene.model.offset).toEqual([0.1, 0.2, 0.3]);
    expect(viewer.groundedOffset).toHaveBeenCalledWith({ rotation: store.scene.model.rotation, scale: undefined });
    expect(store.scene.annotations[0].position).toEqual([0.1, 0.5, 0]);
    expect(AUTO_ORIENT_NOTE).toContain('Undo in Edit → Model');
  });

  it('says so when the model has no usable points', () => {
    const { store, toast, tools } = setup(new Float32Array(3));
    expect(tools.autoOrient()).toBe(false);
    expect(store.scene.model.rotation).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Could not work out'), 'error');
  });

  it('rotates, flips and turns about world axes, re-grounding and reframing each time', () => {
    const { store, viewer, click } = setup();
    click('Rotate +90° about Y');
    expect(store.scene.model.rotation).toEqual([0, 1.570796, 0]);
    expect(viewer.flyTo).toHaveBeenCalledTimes(1);
    click('Rotate −90° about Y');
    expect(rotationDistance(matrixFromEulerXYZ(store.scene.model.rotation!), matrixFromEulerXYZ([0, 0, 0]))).toBeLessThan(1e-5);
    click('Turn upside down (180° about X)');
    expect(rotationDistance(matrixFromEulerXYZ(store.scene.model.rotation!), axisAngle('x', Math.PI))).toBeLessThan(1e-5);
    click('Swap front and back (180° about Y)');
    expect(rotationDistance(matrixFromEulerXYZ(store.scene.model.rotation!), axisAngle('z', Math.PI))).toBeLessThan(1e-5);
    expect(store.scene.model.offset).toEqual([0.1, 0.2, 0.3]);
  });

  it('nudges, re-grounds, scales (keeping the bike grounded) and sets the real length', () => {
    const { store, click, input, panel } = setup();
    click('Move +1 cm along Y');
    click('Move −1 cm along X');
    expect(store.scene.model.offset).toEqual([-0.01, 0.01, 0]);
    click('Center on X/Z and stand on the ground');
    expect(store.scene.model.offset).toEqual([0.1, 0.2, 0.3]);
    input('scale', '2');
    expect(store.scene.model.scale).toBe(2);
    expect(store.scene.model.offset).toEqual([0.2, 0.4, 0.6]);
    input('scale', '-1'); // ignored
    expect(store.scene.model.scale).toBe(2);
    expect(panel().querySelector<HTMLInputElement>('input[name=length]')!.value).toBe('170');
    input('length', '85');
    expect(store.scene.model.scale).toBe(1);
  });

  it('measures the longest horizontal side, even turned 90°', () => {
    const { click, panel } = setup();
    click('Rotate +90° about Y');
    expect(panel().querySelector<HTMLInputElement>('input[name=length]')!.value).toBe('170');
  });

  it('undoes step by step, then resets to the model as loaded', () => {
    const { store, toast, click } = setup();
    click('Undo the last model change');
    expect(toast).toHaveBeenCalledWith('Nothing to undo.');
    click('Stand the bike upright, length along the X axis, on the ground');
    const oriented = store.scene.model.rotation;
    click('Rotate +90° about Z');
    click('Undo the last model change');
    expect(store.scene.model.rotation).toEqual(oriented);
    click('Undo the last model change');
    // Back to as loaded, but explicit so the next load does not auto-orient again.
    expect(store.scene.model.rotation).toEqual([0, 0, 0]);
    click('Back to the model as loaded');
    expect(store.scene.model).toMatchObject({ rotation: [0, 0, 0], scale: 1, offset: [0, 0, 0] });
  });

  it('keeps the section open or closed across re-renders and caps the undo history', () => {
    const { tools, panel, click, store } = setup();
    const details = panel() as HTMLDetailsElement;
    expect(details.open).toBe(true);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect((panel() as HTMLDetailsElement).open).toBe(false);
    for (let i = 0; i < 40; i++) click('Move +1 cm along Z');
    for (let i = 0; i < 40; i++) click('Undo the last model change');
    expect(store.scene.model.offset).toEqual([0, 0, 0.1]); // 30 steps of history
    tools.clearHistory();
    click('Undo the last model change');
    expect(store.scene.model.offset).toEqual([0, 0, 0.1]);
  });

  it('ignores bad lengths, unmeasurable models and a failed Auto-orient button', () => {
    const { store, viewer, click, input, panel } = setup(new Float32Array(3));
    input('scale', '3'); // no offset yet: nothing to rescale
    expect(store.scene.model).toMatchObject({ scale: 3, offset: undefined });
    input('length', '0');
    expect(store.scene.model.scale).toBe(3);
    viewer.boundsWith.mockReturnValue(<ReturnType<typeof viewer.boundsWith>>(<unknown>{ isEmpty: () => true, min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }));
    input('scale', '1');
    expect(panel().querySelector<HTMLInputElement>('input[name=length]')!.value).toBe('');
    input('length', '170');
    expect(store.scene.model.scale).toBe(1);
    viewer.flyTo.mockClear();
    click('Stand the bike upright, length along the X axis, on the ground');
    expect(viewer.flyTo).not.toHaveBeenCalled();
  });
});
