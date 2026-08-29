#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';

const reportArgs = process.argv.filter((arg) => arg.startsWith('--report='));
const baselineArgs = process.argv.filter((arg) => arg.startsWith('--baseline='));
const reportPath = reportArgs.at(-1)?.slice('--report='.length);
const baselinePath = baselineArgs.at(-1)?.slice('--baseline='.length);
const update = process.argv.includes('--update');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableFixture(fixture) {
  // Normalize fixture paths to repo-relative forward slashes so the baseline
  // survives the repo living at a different absolute path (checked out, copied,
  // or on another machine). Absolute paths made compareReports repo-root-bound.
  let fixturePath = String(fixture.fixture ?? '');
  try {
    fixturePath = path.relative(process.cwd(), fixturePath).split(path.sep).join('/');
  } catch {
    // Keep the raw value when it cannot be relativized.
  }
  return {
    fixture: fixturePath,
    platform: fixture.platform,
    entries: fixture.entries,
    bodyBytes: fixture.bodyBytes
  };
}

function fixtureList(report) {
  if (Array.isArray(report?.fixtures)) return report.fixtures;
  return Array.isArray(report?.public) ? report.public : [];
}

export function compareReports(actual, expected) {
  // Key maps by the NORMALIZED fixture path, not the raw one — raw absolute
  // paths made every cross-directory comparison report missing/unexpected.
  const actualFixtures = new Map(fixtureList(actual).map((fixture) => {
    const stable = stableFixture(fixture);
    return [stable.fixture, stable];
  }));
  const expectedFixtures = new Map(fixtureList(expected).map((fixture) => {
    const stable = stableFixture(fixture);
    return [stable.fixture, stable];
  }));
  const differences = [];
  for (const fixture of new Set([...actualFixtures.keys(), ...expectedFixtures.keys()])) {
    const a = actualFixtures.get(fixture);
    const e = expectedFixtures.get(fixture);
    if (!a) differences.push({ fixture, type: 'missing' });
    else if (!e) differences.push({ fixture, type: 'unexpected' });
    else if (JSON.stringify(a) !== JSON.stringify(e)) differences.push({ fixture, type: 'changed', actual: a, expected: e });
  }
  return differences;
}

if (process.argv[1]?.endsWith('har-compare.js')) {
  if (!reportPath || !baselinePath) {
    console.error('Usage: bun tools/har-compare.js --report=.artifacts/har-report.json --baseline=tests/fixtures/har/expected/baseline.json [--update]');
    process.exit(1);
  }
  const actual = readJson(reportPath);
  if (update) {
    fs.mkdirSync(path.dirname(path.resolve(baselinePath)), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    console.log(`HAR baseline updated: ${baselinePath}`);
  } else {
    const expected = readJson(baselinePath);
    const differences = compareReports(actual, expected);
    if (differences.length) {
      console.error(`HAR baseline mismatch: ${differences.length} fixture(s)`);
      console.error(JSON.stringify(differences, null, 2));
      process.exit(1);
    }
    console.log('HAR baseline comparison passed.');
  }
}

export { stableFixture };
void fs;
void path;
void update;
void baselinePath;
void reportPath;
