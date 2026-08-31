#!/usr/bin/env bun
/** Runs one suite in a dedicated process for test isolation. */
import { getSuite } from './suites.js';

const suiteId = process.argv[2];
const suite = getSuite(suiteId);

if (!suite) {
  console.error(`Unknown test suite: ${suiteId || '(missing id)'}`);
  process.exit(2);
}

const startedAt = Date.now();
console.log(`SUITE_START ${suite.id} ${suite.name}`);
try {
  await suite.fn();
  console.log(`SUITE_PASS ${suite.id} ${Date.now() - startedAt}ms`);
} catch (error) {
  console.error(`SUITE_FAIL ${suite.id}`);
  console.error(error?.stack || error);
  process.exitCode = 1;
}
