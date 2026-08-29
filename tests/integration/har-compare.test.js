import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compareReports } from '../../tools/har-compare.js';

export function runHarCompareTests() {
  const fixture = { fixture: 'example.har', platform: 'instagram', entries: 1, bodyBytes: 10, sensitiveFindings: [] };
  assert.deepEqual(compareReports({ fixtures: [fixture] }, { fixtures: [fixture] }), []);
  assert.equal(compareReports({ fixtures: [{ ...fixture, entries: 2 }] }, { fixtures: [fixture] })[0].type, 'changed');

  const a = { fixtures: [{ fixture: 'a.har', platform: 'instagram', entries: 1, bodyBytes: 1 }] };
  const b = { fixtures: [{ fixture: 'b.har', platform: 'reddit', entries: 1, bodyBytes: 1 }] };
  assert.deepEqual(compareReports(a, b).map((x) => x.type).sort(), ['missing', 'unexpected']);

  const aSens = { fixtures: [{ fixture: 'a.har', platform: 'instagram', entries: 1, bodyBytes: 1, sensitiveFindings: [] }] };
  const bSens = { fixtures: [{ fixture: 'a.har', platform: 'instagram', entries: 1, bodyBytes: 1, sensitiveFindings: ['private-capture-not-scanned'] }] };
  assert.deepEqual(compareReports(aSens, bSens), []);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running HAR compare tests...');
  runHarCompareTests();
  console.log('✔ HAR compare tests passed.');
}
