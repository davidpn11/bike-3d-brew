import './styles.css';
import { type Annotation, type BikeScene, type Hotspot, SCHEMA, parseScene } from './scene/schema';
import { SceneStore, safeLocalStorage } from './scene/store';
import { App } from './ui/app';
import { DEMO_HOTSPOTS } from './viewer/demoBike';
import { Viewer } from './viewer/Viewer';

const DEMO_ID = 'demo-road';
const LAST_KEY = 'bike-scene:last';

const storage = safeLocalStorage();
const $ = (id: string) => document.getElementById(id)!;

const viewer = new Viewer($('viewport'));
const params = new URLSearchParams(location.search);
const sceneUrl = params.get('scene');
const baseUrl = sceneUrl ? new URL(sceneUrl, location.href).href : location.href;

const store = new SceneStore(emptyDemo(), storage);
store.subscribe((s) => {
  try {
    storage?.setItem(LAST_KEY, s.id);
  } catch {
    /* ignore */
  }
});
const app = new App(store, viewer, { topbar: $('topbar'), stage: $('stage'), panel: $('panel') }, baseUrl);
document.body.dataset.mode = 'view';

// Test hook for the Playwright suite (docs/TESTING.md): dev server or `?e2e` only, so tests can
// wait on app state and find pickable points on the canvas instead of sleeping or guessing pixels.
const testHook = import.meta.env.DEV || params.has('e2e') ? { app, store, viewer, ready: false } : null;
if (testHook) (window as unknown as { __bike: typeof testHook }).__bike = testHook;

boot()
  .catch((err) => app.toast(err instanceof Error ? err.message : String(err), 'error', 0))
  .finally(() => {
    if (testHook) testHook.ready = true;
  });

async function boot(): Promise<void> {
  if (sceneUrl) {
    const res = await fetch(sceneUrl);
    if (!res.ok) throw new Error(`Could not load scene ${sceneUrl} (${res.status})`);
    const remote = parseScene(await res.json());
    // Local edits to a published scene win until the user exports them.
    await app.open(params.has('fresh') ? remote : (SceneStore.restore(remote.id, storage) ?? remote));
  } else {
    const lastId = storage?.getItem(LAST_KEY);
    const saved = lastId ? SceneStore.restore(lastId, storage) : null;
    if (saved && saved.id !== DEMO_ID) {
      await app.open(saved);
      return;
    }
    const demo = SceneStore.restore(DEMO_ID, storage);
    await app.open(demo ?? emptyDemo());
    if (!demo) seedDemo();
  }
  if (params.get('mode') === 'present') app.setMode('present');
}

function emptyDemo(): BikeScene {
  return {
    schema: SCHEMA,
    id: DEMO_ID,
    name: 'Demo Road Bike',
    brand: 'Brew Cycles',
    modelName: 'Aero R1',
    year: 2026,
    price: '$4,299',
    model: { url: 'demo:road', format: 'demo' },
    background: 'studio',
    hotspots: [],
    annotations: [],
  };
}

/** Derives areas and sample sales comments from the procedural bike's real geometry. */
function seedDemo(): void {
  const hotspots: Hotspot[] = [];
  for (const { part, name, direction } of DEMO_HOTSPOTS) {
    const box = viewer.boundsOf(part);
    if (box) hotspots.push({ id: `hs-${part}`, name, view: viewer.viewOfBounds(box, direction, part === 'frame' ? 1.05 : 1.6) });
  }
  const samples: { part: string; dir: [number, number, number]; note: Omit<Annotation, 'id' | 'position' | 'normal' | 'createdAt'> }[] = [
    { part: 'fork', dir: [1, 0.2, 0.6], note: { title: 'Full-carbon tapered fork', body: 'Tapered 1⅛"–1½" steerer for precise steering; clearance for 32 mm tyres.', kind: 'feature', hotspotId: 'hs-fork' } },
    { part: 'fork', dir: [0.4, -0.2, 1], note: { title: '12 mm thru-axle', body: 'Stiffer than quick release and keeps disc rotors perfectly aligned.', kind: 'spec', hotspotId: 'hs-fork' } },
    { part: 'drivetrain', dir: [0, 0, 1], note: { title: 'Shimano 105 Di2 12-speed', body: 'Electronic shifting: crisp, maintenance-free gear changes.', kind: 'feature', hotspotId: 'hs-drivetrain' } },
    { part: 'drivetrain', dir: [-0.3, 0.2, 1], note: { title: 'Upgrade to Ultegra Di2', body: '180 g lighter, wider range cassette.', kind: 'upgrade', price: '+$900', hotspotId: 'hs-drivetrain' } },
    { part: 'cockpit', dir: [0.3, 1, 0.3], note: { title: 'Integrated carbon cockpit', body: 'Hidden cables, aero profile and a cleaner look.', kind: 'feature', hotspotId: 'hs-cockpit' } },
    { part: 'saddle', dir: [0, 1, 0.2], note: { title: 'Fizik Argo saddle', body: 'Short-nose design, swap free within 30 days if it doesn’t fit.', kind: 'note', hotspotId: 'hs-saddle' } },
    { part: 'front-wheel', dir: [0.2, 0.9, 0.6], note: { title: 'Carbon 45 mm wheelset', body: 'Tubeless-ready, aero rim depth.', kind: 'upgrade', price: '+$600', hotspotId: 'hs-front-wheel' } },
  ];
  const annotations: Annotation[] = [];
  samples.forEach(({ part, dir, note }, i) => {
    const hit = viewer.surfacePoint(part, dir);
    if (hit) annotations.push({ ...note, id: `note-demo-${i}`, position: hit.position, normal: hit.normal, createdAt: new Date().toISOString() });
  });
  store.replace({ ...store.scene, hotspots, annotations });
}
