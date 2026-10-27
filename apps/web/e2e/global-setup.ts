import { writeFileSync } from 'node:fs';
import { buildBikeCapture } from '../../../tools/fixtures/make-bike-capture.mjs';
import { writeFixtures } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { FIXTURE_DIR } from './helpers';

/** Generates the synthetic capture bundles once per run (deterministic, gitignored). */
export default async function globalSetup(): Promise<void> {
  await writeFixtures(FIXTURE_DIR);
  // A scan that came out lying on its side (auto-orient), and an area-mode scan with a floor slab,
  // a wall and a crate around the bike (crop box).
  writeFileSync(`${FIXTURE_DIR}/tilted-bike.bikecapture.zip`, buildBikeCapture({ name: 'Tilted Fixture Bike', rotate: [70, 25, -40], offset: [0.4, 1.2, -0.3] }));
  writeFileSync(`${FIXTURE_DIR}/area-bike.bikecapture.zip`, buildBikeCapture({ name: 'Area Fixture Bike', rotate: [0, 0, 0], offset: [0, 0, 0], mode: 'area', ground: true }));
}
