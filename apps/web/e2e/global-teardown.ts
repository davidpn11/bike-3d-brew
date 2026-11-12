import { convertE2eCoverage } from '../../../tools/coverage/e2e-coverage.mjs';

/** With E2E_COVERAGE=1: the run's raw V8 coverage → coverage-e2e/coverage-final.json. */
export default async function globalTeardown(): Promise<void> {
  if (!process.env.E2E_COVERAGE) return;
  const out = await convertE2eCoverage();
  console.log(out ? `E2E coverage: ${out}` : 'E2E coverage: nothing recorded');
}
