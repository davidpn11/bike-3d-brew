import { estimateOrientation, rotateAboutWorld } from '../scene/orient';
import type { BikeScene, ModelRef, Vec3 } from '../scene/schema';
import type { SceneStore } from '../scene/store';
import type { Viewer } from '../viewer/Viewer';
import { h } from './dom';

export const AUTO_ORIENT_NOTE = 'Auto-oriented. Undo in Edit → Model';

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];
const NUDGE = 0.01; // 1 cm in world meters
const HISTORY = 30;

/**
 * Edit → Model: orientation, scale and position of the loaded model. Every action writes
 * `model.rotation/scale/offset` in one store update; comments and areas live in model-root
 * space, so they move with the bike. Keeps its own small undo stack of model transforms.
 */
export class ModelTools {
  private history: ModelRef[] = [];
  private open = true;

  constructor(
    private store: SceneStore,
    private viewer: Viewer,
    private toast: (message: string, tone?: 'info' | 'error', ms?: number) => void,
  ) {}

  clearHistory(): void {
    this.history = [];
  }

  /** Stands the bike upright facing +X, centered on the ground. Returns false if the model gave no usable points. */
  autoOrient(): boolean {
    const result = estimateOrientation(this.viewer.samplePositions());
    if (!result) {
      this.toast('Could not work out the orientation of this model. Use the rotate buttons instead.', 'error');
      return false;
    }
    const scale = this.store.scene.model.scale;
    this.apply({ rotation: result.rotation, offset: this.viewer.groundedOffset({ rotation: result.rotation, scale }) });
    return true;
  }

  render(scene: BikeScene): HTMLElement {
    const model = scene.model;
    const scale = model.scale ?? 1;
    const length = this.lengthCm(model);
    const button = (label: string, title: string, onclick: () => void, cls = '') => h('button', { type: 'button', class: cls, title, onclick }, label);
    const axisRow = (label: string, make: (axis: Axis, sign: 1 | -1) => HTMLButtonElement) =>
      h('div', { class: 'axis-row' }, h('span', {}, label), ...AXES.map((a) => h('span', { class: 'pair' }, make(a, -1), make(a, 1))));

    const scaleInput = h('input', {
      type: 'number',
      name: 'scale',
      min: '0.0001',
      step: '0.01',
      value: String(+scale.toFixed(4)),
      onchange: (e: Event) => this.setScale(Number((e.target as HTMLInputElement).value)),
    });
    const lengthInput = h('input', {
      type: 'number',
      name: 'length',
      min: '1',
      step: '1',
      value: length ? String(Math.round(length)) : '',
      title: 'Measured tyre-to-tyre length. Type the real one to fix the scale.',
      onchange: (e: Event) => {
        const want = Number((e.target as HTMLInputElement).value);
        if (length && want > 0) this.setScale(scale * (want / length));
      },
    });

    const details = h(
      'details',
      { class: 'model-tools', open: this.open, ontoggle: (e: Event) => (this.open = (e.target as HTMLDetailsElement).open) },
      h('summary', {}, h('h2', {}, 'Model')),
      h(
        'div',
        { class: 'row' },
        button('Auto-orient', 'Stand the bike upright, length along the X axis, on the ground', () => {
          if (this.autoOrient()) this.reframe();
        }, 'primary'),
        button('Undo', 'Undo the last model change', () => this.undo()),
        button('Reset', 'Back to the model as loaded', () => this.apply({ rotation: [0, 0, 0], scale: 1, offset: [0, 0, 0] }, true)),
      ),
      axisRow('Rotate 90°', (axis, sign) =>
        button(`${axis.toUpperCase()}${sign > 0 ? '+' : '−'}`, `Rotate ${sign > 0 ? '+' : '−'}90° about ${axis.toUpperCase()}`, () => this.rotate(axis, (sign * Math.PI) / 2)),
      ),
      h(
        'div',
        { class: 'row' },
        button('Flip ↕', 'Turn upside down (180° about X)', () => this.rotate('x', Math.PI)),
        button('Turn 180°', 'Swap front and back (180° about Y)', () => this.rotate('y', Math.PI)),
        button('On ground', 'Center on X/Z and stand on the ground', () => this.apply({ offset: this.viewer.groundedOffset(this.store.scene.model) })),
      ),
      h('div', { class: 'row' }, h('label', {}, 'Scale', scaleInput), h('label', {}, 'Real length (cm)', lengthInput)),
      axisRow('Move 1 cm', (axis, sign) =>
        button(`${axis.toUpperCase()}${sign > 0 ? '+' : '−'}`, `Move ${sign > 0 ? '+' : '−'}1 cm along ${axis.toUpperCase()}`, () => this.nudge(axis, sign)),
      ),
    );
    return details;
  }

  private measured = { key: '', cm: null as number | null };
  /** Overall length in cm. Exact bounds walk every vertex, so memoize per transform. */
  private lengthCm(model: ModelRef): number | null {
    const key = JSON.stringify([model.url, model.rotation, model.scale]);
    if (key !== this.measured.key) {
      const box = this.viewer.boundsWith(model);
      // Longest horizontal side, so it still means "length" while the bike is turned 90°.
      this.measured = { key, cm: box.isEmpty() ? null : Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 100 };
    }
    return this.measured.cm;
  }

  private rotate(axis: Axis, angle: number): void {
    const model = this.store.scene.model;
    const rotation = rotateAboutWorld(model.rotation, axis, angle);
    this.apply({ rotation, offset: this.viewer.groundedOffset({ rotation, scale: model.scale }) }, true);
  }

  private setScale(next: number): void {
    if (!(next > 0) || !Number.isFinite(next)) return;
    const model = this.store.scene.model;
    const ratio = next / (model.scale ?? 1);
    // Scaling happens about the model-root origin; scaling the offset too keeps a grounded bike grounded.
    const offset = model.offset ? (model.offset.map((v) => round(v * ratio)) as Vec3) : undefined;
    this.apply({ scale: round(next), offset }, true);
  }

  private nudge(axis: Axis, sign: 1 | -1): void {
    const offset: Vec3 = [...(this.store.scene.model.offset ?? [0, 0, 0])];
    offset[AXES.indexOf(axis)] = round(offset[AXES.indexOf(axis)] + sign * NUDGE);
    this.apply({ offset });
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) {
      this.toast('Nothing to undo.');
      return;
    }
    // An explicit identity rotation stops the next load from auto-orienting the capture again.
    this.store.update({ model: { ...prev, rotation: prev.rotation ?? [0, 0, 0] } });
    this.reframe();
  }

  private apply(patch: Partial<Pick<ModelRef, 'rotation' | 'scale' | 'offset'>>, reframe = false): void {
    const current = this.store.scene.model;
    this.history.push(current);
    if (this.history.length > HISTORY) this.history.shift();
    this.store.update({ model: { ...current, ...patch } });
    if (reframe) this.reframe();
  }

  private reframe(): void {
    this.viewer.applyTransform(this.store.scene.model);
    void this.viewer.flyTo(this.viewer.overviewView(), 600);
  }
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
