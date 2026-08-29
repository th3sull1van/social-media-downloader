import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  classifyHarPath,
  inspectHar,
  validateHarDocument,
  createReport
} from '../../tools/validation/har-validation.js';

export function runHarValidationUnitTests() {
  assert.equal(classifyHarPath('fixtures-private/www.instagram.com-example.har'), 'instagram');
  assert.equal(classifyHarPath('tests/fixtures/har/facebook/photos.har'), 'facebook');
  assert.equal(classifyHarPath('capture.example.har'), 'unknown');

  assert.throws(
    () => validateHarDocument({ log: { entries: [{ request: { headers: [{ name: 'Cookie', value: 'secret' }] } }] } }),
    /sensitive/i
  );
  assert.throws(() => validateHarDocument({}), /log\.entries/i);

  const document = {
    log: {
      version: '1.2',
      entries: [{
        request: { method: 'GET', url: 'https://www.example.com/data' },
        response: { status: 200, content: { mimeType: 'application/json', text: '{"ok":true}' } }
      }]
    }
  };
  const inspection = inspectHar(document, 'tests/fixtures/har/instagram/example.har');
  assert.equal(inspection.entries, 1);
  assert.equal(inspection.sensitiveFindings.length, 0);
  assert.equal(inspection.platform, 'instagram');
  assert.equal(inspection.bodyBytes, 11);

  const report = createReport([
    { platform: 'reddit', fixture: 'b.har', entries: 2, bodyBytes: 10, sensitiveFindings: [] },
    { platform: 'instagram', fixture: 'a.har', entries: 1, bodyBytes: 5, sensitiveFindings: [] }
  ]);
  assert.deepEqual(report.fixtures.map((x) => x.fixture), ['a.har', 'b.har']);
  assert.equal(report.schemaVersion, 1);
  assert.ok(!JSON.stringify(report).includes('ok'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running HAR validation unit tests...');
  runHarValidationUnitTests();
  console.log('✔ HAR validation unit tests passed.');
}
