import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateCompactFixture } from '../../tools/validation/fixture-validation.js';

function makeFixture(overrides = {}) {
  return {
    fixtureVersion: 1,
    fixtureType: 'facebook-replay',
    extractionVersion: 1,
    sanitizationVersion: 1,
    platform: 'facebook',
    scenario: 'validator-test',
    sourceCaptureId: 'validator-test',
    capturedAt: '2026-08-31',
    browser: 'Chrome',
    sanitized: true,
    source: 'unit-test',
    purpose: 'Fixture sanitizer validation',
    graphqlBodies: [],
    ...overrides
  };
}

export function runFixtureValidationTests() {
  assert.doesNotThrow(() => validateCompactFixture(makeFixture({
    graphqlBodies: [{
      data: {
        node: {
          id: 'fb_photo_001',
          image: { uri: 'https://scontent.example.fbcdn.net/fixture/photo.jpg?oh=synthetic-oh&oe=synthetic-oe' }
        }
      }
    }]
  })));

  for (const [name, value] of [
    ['cookie', 'session-value-that-must-never-be-committed'],
    ['authorization', 'Bearer abcdefghijklmnopqrstuvwxyz012345'],
    ['nested token query', 'https://cdn.example.test/photo.jpg?access_token=real-token-value'],
    ['executable HTML', '<script>window.privateToken="x"</script>']
  ]) {
    assert.throws(
      () => validateCompactFixture(makeFixture({ diagnostic: { [name]: value } })),
      /Sensitive or executable data/,
      `${name} must be rejected`
    );
  }

  assert.throws(
    () => validateCompactFixture(makeFixture({ sanitized: false })),
    /must be marked sanitized/
  );
  assert.throws(
    () => validateCompactFixture(makeFixture({ sourceCaptureId: 'fixtures-private/profile' })),
    /safe synthetic sourceCaptureId/
  );
  assert.throws(
    () => validateCompactFixture(makeFixture({ sourceCaptureId: 'private user@example.com' })),
    /safe synthetic sourceCaptureId/
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running compact fixture validation tests...');
  runFixtureValidationTests();
  console.log('✔ compact fixture validation tests passed.');
}
