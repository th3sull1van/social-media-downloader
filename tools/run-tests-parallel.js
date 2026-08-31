#!/usr/bin/env bun
/**
 * Process-isolated test runner.
 *
 * Suites do not share globalThis, module caches, fetch stubs, chrome stubs, or
 * singleton registries. This is why this runner uses Bun.spawn instead of
 * Promise.all over suite functions in one process.
 */
import { suites } from '../tests/suites.js';

const bunRuntime = /** @type {any} */ (globalThis).Bun;

function parseJobs() {
  const value = process.argv.find((arg) => arg.startsWith('--jobs='))?.slice('--jobs='.length);
  if (value === undefined) return Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 2) - 1));
  const jobs = Number.parseInt(value, 10);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs must be a positive integer');
  return jobs;
}

async function runSuite(suite) {
  if (!bunRuntime || typeof bunRuntime.spawn !== 'function') {
    throw new Error('test:parallel requires the Bun runtime');
  }
  const child = bunRuntime.spawn([process.execPath, 'tests/run-suite.js', suite.id], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);

  return { suite, stdout, stderr, exitCode };
}

async function main() {
  const jobs = parseJobs();
  const startTime = Date.now();
  const results = new Array(suites.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= suites.length) return;
      results[index] = await runSuite(suites[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, () => worker()));

  let failed = 0;
  for (const result of results) {
    process.stdout.write(`\n• ${result.suite.name}\n`);
    if (result.stdout.trim()) process.stdout.write(`${result.stdout.trim()}\n`);
    // Print both streams through stdout after the child has finished. Using the
    // parent's stderr here lets Windows reorder diagnostics relative to the
    // stable suite headings, which makes failures harder to attribute.
    if (result.stderr.trim()) process.stdout.write(`${result.stderr.trim()}\n`);
    if (result.exitCode === 0) {
      console.log('\x1b[32m[PASSED]\x1b[0m');
    } else {
      console.log(`\x1b[31m[FAILED: exit ${result.exitCode}]\x1b[0m`);
      failed++;
    }
  }

  const duration = Date.now() - startTime;
  console.log('\n----------------------------------------------------');
  console.log(`Parallel result: ${suites.length - failed}/${suites.length} suites passed in ${duration}ms (${jobs} workers).`);
  console.log('----------------------------------------------------');
  process.exitCode = failed === 0 ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 2;
}
