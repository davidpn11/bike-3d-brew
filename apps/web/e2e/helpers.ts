import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Download, type Page, type TestInfo, expect } from '@playwright/test';
import type { SceneStore } from '../src/scene/store';
import type { App } from '../src/ui/app';
import type { Viewer } from '../src/viewer/Viewer';

/** The test hook main.ts installs with `?e2e` (or in dev). Keep usage read-mostly: drive the UI like a user. */
export interface BikeHook {
  app: App;
  store: SceneStore;
  viewer: Viewer;
  ready: boolean;
}
declare global {
  interface Window {
    __bike?: BikeHook;
  }
}

export const FIXTURE_DIR = fileURLToPath(new URL('./.fixtures', import.meta.url));
export const fixture = (name: string) => `${FIXTURE_DIR}/${name}`;
/** Committed binary USDC (crate) package shaped like Object Capture output: textured, one mesh. */
export const USDC_FIXTURE = fileURLToPath(new URL('../test/fixtures/object-capture-like.usdz', import.meta.url));
/** Bundle with rendered photos (global-setup.ts); PHOTO_ORBIT orbit shots plus the generator's close-ups. */
export const PHOTO_BUNDLE = 'bike-photos.bikecapture.zip';
export const PHOTO_ORBIT = 16;

/** Makes the capture cache unavailable (no OPFS, no IndexedDB), as in some private modes. */
export async function blockCaptureStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (StorageManager.prototype as { getDirectory?: unknown }).getDirectory;
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
  });
}

/** Console errors and uncaught exceptions; tests assert this stays empty. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Opens the app with the test hook and waits until boot finished and a model is on stage. */
export async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(`./?e2e${query ? `&${query}` : ''}`);
  await waitReady(page);
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__bike?.ready === true);
}

/** Waits until the model root holds a loaded model. */
export async function waitForModel(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bike?.viewer.modelRoot.children.length ?? 0) > 0);
}

export async function waitForCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__bike?.viewer.flying === false);
}

export const scene = (page: Page) => page.evaluate(() => window.__bike!.store.scene);

/**
 * A client-space point where a tap lands on the model (and on the canvas itself, not on a pin or
 * toast). Searches outward from the canvas center; the app's own raycast decides what is a hit.
 */
export async function modelPoint(page: Page): Promise<{ x: number; y: number }> {
  await waitForCamera(page);
  const point = await page.evaluate(() => {
    const { viewer } = window.__bike!;
    const canvas = viewer.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let ring = 0; ring < 40; ring++) {
      const steps = Math.max(1, ring * 8);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * ring * 6);
        const y = Math.round(cy + Math.sin(a) * ring * 6);
        if (x < r.left + 4 || x > r.right - 4 || y < r.top + 4 || y > r.bottom - 4) continue;
        if (document.elementFromPoint(x, y) !== canvas) continue;
        if (viewer.pick(x, y)) return { x, y };
      }
    }
    return null;
  });
  expect(point, 'no pickable point on the model').not.toBeNull();
  return point!;
}

/** Taps (mobile project) or clicks (desktop) the canvas at a client point. */
export async function tapCanvas(page: Page, p: { x: number; y: number }): Promise<void> {
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Drops a file on the stage through a real DragEvent with a DataTransfer, like Finder/Files would. */
export async function dropFile(page: Page, path: string, name = path.split('/').pop()!): Promise<void> {
  const base64 = readFileSync(path).toString('base64');
  await page.evaluate(
    ({ base64, name }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name));
      const stage = document.getElementById('stage')!;
      stage.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { base64, name },
  );
}

/** Picks a file through the Open… button's hidden file input. */
export async function openViaPicker(page: Page, files: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.locator('#topbar input[type=file]').setInputFiles(files);
}

export const toast = (page: Page) => page.locator('.toast');

export async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFileSync(path);
}

/** Visual sanity only: attached to the report, never pixel-diffed (SwiftShader output varies). */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
