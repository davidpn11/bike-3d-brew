import { writeFixtures } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { FIXTURE_DIR } from './helpers';

/** Generates the synthetic capture bundles once per run (deterministic, gitignored). */
export default async function globalSetup(): Promise<void> {
  await writeFixtures(FIXTURE_DIR);
}
