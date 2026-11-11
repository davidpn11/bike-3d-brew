import { writeFileSync } from 'node:fs';
import { buildBikeCapture } from '../../../tools/fixtures/make-bike-capture.mjs';
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
  // A scan that came out lying on its side (auto-orient), and an area-mode scan with a floor slab,
  // a wall and a crate around the bike (crop box).
  writeFileSync(`${FIXTURE_DIR}/tilted-bike.bikecapture.zip`, buildBikeCapture({ name: 'Tilted Fixture Bike', rotate: [70, 25, -40], offset: [0.4, 1.2, -0.3] }));
  writeFileSync(`${FIXTURE_DIR}/area-bike.bikecapture.zip`, buildBikeCapture({ name: 'Area Fixture Bike', rotate: [0, 0, 0], offset: [0, 0, 0], mode: 'area', ground: true }));
  const photos = await renderPhotos(capturePoses(PHOTO_ORBIT), { executablePath: process.env.PW_CHROMIUM_PATH });
  writeFileSync(fixture(PHOTO_BUNDLE), makeBundle({ name: 'Fixture Photo Bike', count: PHOTO_ORBIT, images: photos.map((p) => ({ ext: 'jpg', data: p.data })) }));
}
