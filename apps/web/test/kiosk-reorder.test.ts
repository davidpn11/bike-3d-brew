import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kiosk, type KioskState } from '../src/scene/kiosk';
import { dropIndex, moveItem, stepItem } from '../src/scene/reorder';
import { SceneStore } from '../src/scene/store';
import { SCHEMA, type BikeScene } from '../src/scene/schema';

afterEach(() => vi.useRealTimers());

describe('Kiosk', () => {
  function setup() {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    const states: KioskState[] = [];
    const kiosk = new Kiosk({ interval: 1000, idle: 5000, onAdvance, onChange: (s) => states.push(s) });
    return { kiosk, onAdvance, states };
  }

  it('advances every interval while playing and stops on stop()', () => {
    const { kiosk, onAdvance, states } = setup();
    expect(kiosk.state).toBe('off');
    kiosk.play();
    vi.advanceTimersByTime(999);
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(onAdvance).toHaveBeenCalledTimes(4);
    kiosk.stop();
    vi.advanceTimersByTime(10_000);
    expect(onAdvance).toHaveBeenCalledTimes(4);
    expect(states).toEqual(['playing', 'off']);
  });

  it('holds on interaction and resumes after the idle time', () => {
    const { kiosk, onAdvance, states } = setup();
    kiosk.play();
    vi.advanceTimersByTime(900);
    kiosk.interact();
    expect(kiosk.state).toBe('held');
    vi.advanceTimersByTime(4000);
    kiosk.interact(); // more input restarts the idle wait
    vi.advanceTimersByTime(4999);
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kiosk.state).toBe('playing');
    vi.advanceTimersByTime(1000);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['playing', 'held', 'playing']);
  });

  it('ignores interaction when off; toggle, restart and configure', () => {
    const { kiosk, onAdvance } = setup();
    kiosk.interact();
    expect(kiosk.state).toBe('off');
    kiosk.restart();
    expect(kiosk.state).toBe('off');
    kiosk.configure({ interval: 2000, idle: 100 });
    expect(kiosk.interval).toBe(2000);
    kiosk.toggle();
    expect(kiosk.state).toBe('playing');
    vi.advanceTimersByTime(1500);
    kiosk.restart(); // a manual step gets a full interval
    vi.advanceTimersByTime(1500);
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    kiosk.toggle();
    expect(kiosk.state).toBe('off');
  });

  it('a stop() during onAdvance is respected', () => {
    vi.useFakeTimers();
    const kiosk: Kiosk = new Kiosk({ interval: 10, idle: 10, onAdvance: () => kiosk.stop() });
    kiosk.play();
    vi.advanceTimersByTime(100);
    expect(kiosk.state).toBe('off');
  });

  it('accepts injected timers', () => {
    const set = vi.fn(() => 7);
    const clear = vi.fn();
    const kiosk = new Kiosk({ interval: 10, idle: 10, onAdvance: () => {}, setTimer: set, clearTimer: clear });
    kiosk.play();
    kiosk.stop();
    expect(set).toHaveBeenCalledWith(expect.any(Function), 10);
    expect(clear).toHaveBeenCalledWith(7);
  });
});

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((x) => x.id).join('');

describe('moveItem / stepItem', () => {
  it('moves within the whole list', () => {
    const list = items('a', 'b', 'c', 'd');
    expect(ids(moveItem(list, 'a', 2))).toBe('bcad');
    expect(ids(moveItem(list, 'd', 0))).toBe('dabc');
    expect(ids(moveItem(list, 'b', 99))).toBe('acdb');
    expect(ids(moveItem(list, 'c', -5))).toBe('cabd');
    expect(ids(list)).toBe('abcd'); // not mutated
  });

  it('returns the same array when nothing changes', () => {
    const list = items('a', 'b');
    expect(moveItem(list, 'a', 0)).toBe(list);
    expect(moveItem(list, 'zz', 1)).toBe(list);
    expect(moveItem(list, 'a', NaN)).toBe(list);
    expect(stepItem(list, 'a', -1)).toBe(list);
    expect(stepItem(list, 'zz', 1)).toBe(list);
  });

  it('reorders a shown subset among its own slots', () => {
    // b, d and e are one area's comments; a and c stay where they are.
    const list = items('a', 'b', 'c', 'd', 'e');
    expect(ids(moveItem(list, 'e', 0, ['b', 'd', 'e']))).toBe('aecbd');
    expect(ids(stepItem(list, 'd', -1, ['b', 'd', 'e']))).toBe('adcbe');
    expect(ids(stepItem(list, 'b', 1, ['b', 'd', 'e']))).toBe('adcbe');
    expect(ids(stepItem(list, 'c', 1))).toBe('abdce');
  });
});

describe('dropIndex', () => {
  it('counts the other items above the pointer', () => {
    const mids = [10, 30, 50, 70];
    expect(dropIndex(mids, 0, 5)).toBe(0);
    expect(dropIndex(mids, 0, 35)).toBe(1);
    expect(dropIndex(mids, 0, 100)).toBe(3);
    expect(dropIndex(mids, 3, 0)).toBe(0);
    expect(dropIndex(mids, 3, 40)).toBe(2);
  });
});

describe('SceneStore.moveAnnotation', () => {
  it('persists the new order and skips no-op moves', () => {
    const note = (id: string, hotspotId?: string) => ({ id, position: [0, 0, 0] as [number, number, number], title: id, body: '', kind: 'note' as const, hotspotId, createdAt: '' });
    const scene: BikeScene = {
      schema: SCHEMA,
      id: 's',
      name: 'S',
      model: { url: 'demo:road', format: 'demo' },
      background: 'studio',
      hotspots: [],
      annotations: [note('a'), note('b'), note('c')],
    };
    const saved = new Map<string, string>();
    const store = new SceneStore(scene, { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) });
    const listener = vi.fn();
    store.subscribe(listener);
    store.moveAnnotation('c', 0);
    expect(store.scene.annotations.map((a) => a.id)).toEqual(['c', 'a', 'b']);
    expect(JSON.parse(saved.get('bike-scene:s')!).annotations.map((a: { id: string }) => a.id)).toEqual(['c', 'a', 'b']);
    store.moveAnnotation('c', 0);
    store.moveAnnotation('b', 0, ['a', 'b']);
    expect(store.scene.annotations.map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
