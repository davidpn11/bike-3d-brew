import './styles.css';
import { type Annotation, type BikeScene, type Hotspot, SCHEMA, parseScene } from './scene/schema';
import { ShareError, checkPublishedScene, checkSceneUrl, readViewParams } from './scene/share';
import { SceneStore, safeLocalStorage } from './scene/store';
import { openCaptureCache } from './storage/backends';
import { App } from './ui/app';
import { DEMO_HOTSPOTS } from './viewer/demoBike';
import { Viewer } from './viewer/Viewer';

const DEMO_ID = 'demo-road';
const LAST_KEY = 'bike-scene:last';

const storage = safeLocalStorage();
const $ = (id: string) => document.getElementById(id)!;

const viewer = new Viewer($('viewport'));
const params = new URLSearchParams(location.search);
const view = readViewParams(location.search);
const sceneUrl = view.scene;
// An invalid ?scene= is reported by boot(); until then the page itself is the base.
let sceneHref: string | null = null;
try {
  sceneHref = sceneUrl ? checkSceneUrl(sceneUrl, location.href) : null;
} catch {
  /* reported below */
}
const baseUrl = sceneHref ?? location.href;

const store = new SceneStore(emptyDemo(), storage);
store.subscribe((s) => {
  try {
    storage?.setItem(LAST_KEY, s.id);
  } catch {
    /* ignore */
  }
});
// Never rejects: no usable storage just means captures must be re-dropped after a reload.
const cache = openCaptureCache().catch(() => null);
const app = new App(store, viewer, { topbar: $('topbar'), stage: $('stage'), panel: $('panel') }, baseUrl, cache);
document.body.dataset.mode = 'view';
app.configure(view);

// Test hook for the Playwright suite (docs/TESTING.md): dev server or `?e2e` only, so tests can
// wait on app state and find pickable points on the canvas instead of sleeping or guessing pixels.
const testHook = import.meta.env.DEV || params.has('e2e') ? { app, store, viewer, ready: false } : null;
if (testHook) (window as unknown as { __bike: typeof testHook }).__bike = testHook;

boot()
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    app.toast(message, 'error', 0);
    if (view.readOnly) showLinkError(message);
  })
  .finally(() => {
    if (testHook) testHook.ready = true;
  });

async function boot(): Promise<void> {
  if (sceneUrl) {
    const href = checkSceneUrl(sceneUrl, location.href);
    let res: Response;
    try {
      res = await fetch(href);
    } catch {
      throw new ShareError(`Could not load scene ${sceneUrl}: the network request failed. Check your connection and try again.`);
    }
    if (!res.ok) throw new ShareError(`Could not load scene ${sceneUrl} (${res.status})`);
    let remote: BikeScene;
    try {
      remote = checkPublishedScene(parseScene(await res.json()), href, location.href);
    } catch (err) {
      throw new ShareError(`Could not load scene ${sceneUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
    app.published = { param: sceneUrl, scene: remote };
    // Local edits to a published scene win until the user exports them; customers (view=present) always see the published copy.
    await app.open(view.fresh ? remote : (SceneStore.restore(remote.id, storage) ?? remote));
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
  if (view.present) app.setMode('present');
  if (view.kiosk) app.startKiosk();
}

/** The customer link failed: a calm full-stage message instead of an empty viewer. */
function showLinkError(message: string): void {
  const box = document.createElement('div');
  box.className = 'link-error';
  box.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = 'This bike can’t be shown right now';
  const detail = document.createElement('p');
  detail.textContent = message;
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Ask the shop for a new link.';
  box.append(title, detail, hint);
  $('stage').append(box);
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
    { part: 'drivetrain', dir: [-0.3, 0.2, 1], note: { title: 'Upgrade to Ultegra Di2', body: '**180 g lighter**, with a wider-range cassette for climbs.', kind: 'upgrade', price: '+$900', hotspotId: 'hs-drivetrain' } },
    { part: 'cockpit', dir: [0.3, 1, 0.3], note: { title: 'Integrated carbon cockpit', body: 'Hidden cables, aero profile and a cleaner look.', kind: 'feature', hotspotId: 'hs-cockpit' } },
    { part: 'saddle', dir: [0, 1, 0.2], note: { title: 'Fizik Argo saddle', body: 'Short-nose design for an aggressive position.\n- Swap free within **30 days** if it doesn’t fit\n- *Pressure-mapped* fitting in store', kind: 'note', hotspotId: 'hs-saddle' } },
    { part: 'front-wheel', dir: [0.2, 0.9, 0.6], note: { title: 'Carbon 45 mm wheelset', body: 'Tubeless-ready, aero rim depth.', kind: 'upgrade', price: '+$600', hotspotId: 'hs-front-wheel' } },
  ];
  const annotations: Annotation[] = [];
  samples.forEach(({ part, dir, note }, i) => {
    const hit = viewer.surfacePoint(part, dir);
    if (hit) annotations.push({ ...note, id: `note-demo-${i}`, position: hit.position, normal: hit.normal, createdAt: new Date().toISOString() });
  });
  store.replace({ ...store.scene, hotspots, annotations });
}
