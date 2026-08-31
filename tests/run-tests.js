/**
 * Social Media Downloader — Master Automated Test Runner
 *
 * This is the deterministic serial runner. The parallel runner intentionally
 * uses child processes because several suites replace global fetch/chrome state.
 */
import { fileURLToPath } from 'node:url';
import { suites } from './suites.js';

export async function runSuites(selectedSuites = suites, { log = true } = {}) {
  if (log) {
    console.log('====================================================');
    console.log('  AUTOMATED TEST SUITE — SOCIAL MEDIA DOWNLOADER');
    console.log('====================================================\n');
  }

  let passedSuites = 0;
  const startTime = Date.now();

  for (const suite of selectedSuites) {
    process.stdout.write(`• Running: ${suite.name}... `);
    try {
      await suite.fn();
      console.log('\x1b[32m[PASSED]\x1b[0m');
      passedSuites++;
    } catch (err) {
      console.log('\x1b[31m[FAILED]\x1b[0m');
      console.error(err);
      process.exitCode = 1;
    }
  }

  const duration = Date.now() - startTime;
  if (log) {
    console.log('\n----------------------------------------------------');
    console.log(`Result: ${passedSuites}/${selectedSuites.length} test suites passed in ${duration}ms.`);
    console.log('====================================================');

    if (passedSuites === selectedSuites.length) {
      console.log('\x1b[32mALL TEST SUITES PASSED SUCCESSFULLY!\x1b[0m\n');
    } else {
      console.log('\x1b[31mSOME TEST SUITES FAILED.\x1b[0m\n');
    }
  }

  return { passedSuites, totalSuites: selectedSuites.length, duration };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runSuites();
}
