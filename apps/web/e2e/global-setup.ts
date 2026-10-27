import { writeFileSync } from 'node:fs';
import { writeFixtures } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { capturePoses, makeBundle } from '../../../tools/fixtures/make-capture.mjs';
import { renderPhotos } from '../../../tools/fixtures/render-photos.mjs';
import { FIXTURE_DIR, PHOTO_BUNDLE, PHOTO_ORBIT, fixture } from './helpers';

/**
 * Generates the synthetic capture bundles once per run (gitignored):
 * - make-capture-bundle.mjs: the bundle variants (USDZ, GLB, flat, broken, …);
 * - make-capture.mjs + render-photos.mjs: a bundle whose photos are real renders of the fixture
 *   bike from each pose, for the photo close-up tests.
 */
export default async function globalSetup(): Promise<void> {
  await writeFixtures(FIXTURE_DIR);
  const photos = await renderPhotos(capturePoses(PHOTO_ORBIT), { executablePath: process.env.PW_CHROMIUM_PATH });
  writeFileSync(fixture(PHOTO_BUNDLE), makeBundle({ name: 'Fixture Photo Bike', count: PHOTO_ORBIT, images: photos.map((p) => ({ ext: 'jpg', data: p.data })) }));
}
