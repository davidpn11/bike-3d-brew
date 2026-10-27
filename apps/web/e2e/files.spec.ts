import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, dropFile, fixture, modelPoint, openApp, openViaPicker, readDownload, scene, snap, tapCanvas, toast, waitForModel, waitReady } from './helpers';

const CAPTURE_ID = 'capture-fixture-gravel-bike-20260102030405';

test.describe('export / import', () => {
  test('exports the scene as JSON and imports it back', async ({ page }) => {
    await openApp(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
    expect(download.suggestedFilename()).toBe('demo-road-bike.bike.json');
    const exported = JSON.parse((await readDownload(download)).toString('utf8'));
    expect(exported).toMatchObject({ schema: 'bike-scene/1', id: 'demo-road', name: 'Demo Road Bike' });
    expect(exported.annotations).toHaveLength(7);
    expect(exported.hotspots).toHaveLength(6);

    // Re-import an edited copy: a different bike sharing the demo model.
    const edited = { ...exported, id: 'imported-1', name: 'Imported Bike', background: 'dark', annotations: exported.annotations.slice(0, 2) };
    await openViaPicker(page, { name: 'imported.bike.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) });
    await expect(toast(page)).toHaveText('Opened “Imported Bike”.');
    await expect(page.locator('#topbar .brand strong')).toHaveText('Imported Bike');
    await expect(page.locator('#viewport')).toHaveAttribute('data-background', 'dark');
    await expect(page.locator('.comments .comment')).toHaveCount(2);
    expect((await scene(page)).annotations).toEqual(edited.annotations);
  });

  test('a published scene loads from ?scene= with its model', async ({ page }) => {
    const glb = readFileSync(fixture('bike.glb'));
    const published = {
      schema: 'bike-scene/1',
      id: 'published-1',
      name: 'Published Gravel',
      model: { url: 'bike.glb', format: 'glb' },
      background: 'studio',
      hotspots: [{ id: 'hs-front', name: 'Front end', view: { position: [1.5, 0.8, 1.2], target: [0.45, 0.6, 0] } }],
      annotations: [{ id: 'n1', position: [0.45, 0.8, 0], title: 'Flared bars', body: '', kind: 'feature', hotspotId: 'hs-front', createdAt: '2026-01-01T00:00:00Z' }],
    };
    await page.route('**/scenes/gravel/scene.bike.json', (route) => route.fulfill({ json: published }));
    await page.route('**/scenes/gravel/bike.glb', (route) => route.fulfill({ body: glb, contentType: 'model/gltf-binary' }));
    await openApp(page, 'scene=scenes/gravel/scene.bike.json&mode=present');
    await waitForModel(page);
    await expect(page.locator('.present-card header strong')).toHaveText('Published Gravel');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.present-card header strong')).toHaveText('Front end');
    await expect(page.locator('.present-card li')).toHaveText(['Flared bars']);
  });

  test('a missing published scene explains itself', async ({ page }) => {
    await page.route('**/scenes/missing.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
    await openApp(page, 'scene=scenes/missing.json');
    await expect(toast(page)).toHaveText(/Could not load scene scenes\/missing\.json \(404\)/);
    await expect(toast(page)).toHaveAttribute('data-tone', 'error');
  });
});

test.describe('capture bundles', () => {
  test('opens an iPhone capture bundle from the file picker', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await openViaPicker(page, fixture('bike.bikecapture.zip'));
    await expect(toast(page)).toHaveText('Opened capture “Fixture Gravel Bike” · 32 photos · 32 camera poses');
    await expect(page.locator('#topbar .brand strong')).toHaveText('Fixture Gravel Bike');
    // Object Capture removes the background, so captures open on the clear stage.
    await expect(page.locator('#viewport')).toHaveAttribute('data-background', 'transparent');
    await expect(page.locator('#panel .empty')).toHaveText('No comments for this area yet.');
    const s = await scene(page);
    expect(s.id).toBe(CAPTURE_ID);
    expect(s.model).toEqual({ url: 'bundle:bike.bikecapture.zip/model.usdz', format: 'usdz' });
    const meshes = await page.evaluate(() => {
      let n = 0;
      window.__bike!.viewer.modelRoot.traverse((o) => void ((o as { isMesh?: boolean }).isMesh && n++));
      return n;
    });
    expect(meshes).toBe(7);
    await snap(page, testInfo, 'capture-usdz');
    expect(errors).toEqual([]);
  });

  test('drag-and-drop opens GLB and flat (Finder-zipped) bundles', async ({ page }, testInfo) => {
    await openApp(page);
    await dropFile(page, fixture('bike-glb.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture GLB Bike”');
    expect((await scene(page)).model.format).toBe('glb');
    await snap(page, testInfo, 'capture-glb');
    await dropFile(page, fixture('bike-flat.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture Flat Bike”');
  });

  test('re-dropping a bundle after a reload restores its comments', async ({ page }) => {
    await openApp(page);
    await openViaPicker(page, fixture('bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await tapCanvas(page, await modelPoint(page));
    await page.locator('form.editor input[name=title]').fill('Scuff on the top tube');
    await page.locator('form.editor').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.comments .comment')).toHaveCount(1);

    // The model lived only in memory: after a reload the app asks for the bundle again…
    await page.reload();
    await waitReady(page);
    await expect(toast(page)).toHaveText('Drop “bike.bikecapture.zip” onto the viewer to reopen this capture.');
    await expect(page.locator('.comments .comment', { hasText: 'Scuff on the top tube' })).toHaveCount(1);

    // …and dropping it brings the model back with the saved comment.
    await dropFile(page, fixture('bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture Gravel Bike”');
    await waitForModel(page);
    const s = await scene(page);
    expect(s.id).toBe(CAPTURE_ID);
    expect(s.annotations.map((a) => a.title)).toEqual(['Scuff on the top tube']);
  });

  test('a bundle with broken poses still opens, with a warning', async ({ page }) => {
    await openApp(page);
    await openViaPicker(page, fixture('bike-broken-poses.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture Broken Poses” · 32 photos · no camera poses');
    await expect(toast(page)).toContainText('samples[0]');
    await expect(toast(page)).toHaveAttribute('data-tone', 'error');
    await waitForModel(page);
  });

  test('dropping a bare model file starts a new bike', async ({ page }) => {
    await openApp(page);
    await dropFile(page, fixture('bike.glb'));
    await expect(page.locator('#topbar .brand strong')).toHaveText('bike');
    await waitForModel(page);
    expect((await scene(page)).model).toEqual({ url: 'bike.glb', format: 'glb' });
    await expect(page.locator('.comments .comment')).toHaveCount(0);
  });
});

test.describe('bad files', () => {
  const cases: [string, string | { name: string; mimeType: string; buffer: Buffer }, RegExp][] = [
    ['a .zip that is not a zip', fixture('not-a-zip.bikecapture.zip'), /^Could not open capture: the file is not a zip\.$/],
    ['a capture without a model', fixture('bike-no-model.bikecapture.zip'), /^Could not open capture: “Fixture Unfinished Bike” has no 3D model yet/],
    ['a zip without a manifest', { name: 'random.zip', mimeType: 'application/zip', buffer: readFileSync(fixture('bike.usdz')) }, /manifest\.json is missing/],
    ['broken JSON', { name: 'broken.bike.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":') }, /^Not a bike scene: /],
    ['JSON that is not a scene', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"other/1"}') }, /^Not a bike scene: scene\.schema/],
    ['an unsupported file type', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }, /^Unsupported file\./],
    ['a corrupt GLB', { name: 'corrupt.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('definitely not a glb') }, /^Could not load GLB model/],
  ];
  for (const [what, file, message] of cases) {
    test(`shows an error toast for ${what}`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      await openViaPicker(page, file);
      await expect(toast(page)).toHaveText(message);
      await expect(toast(page)).toHaveAttribute('data-tone', 'error');
      // The app keeps working after a bad file.
      await page.getByRole('button', { name: 'Present', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-mode', 'present');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
