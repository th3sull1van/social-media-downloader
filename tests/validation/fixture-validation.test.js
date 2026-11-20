import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompactFixture } from '../../tools/validation/fixture-validation.js';
import { checkDependencyRules } from '../../tools/validation/dependency-rules.js';
import { checkI18nParity } from '../../tools/validation/i18n-check.js';

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
      body: '{"data":{"node":{"id":"fixture_001","label":"session preview"}}}'
    }, {
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
    ['executable HTML', '<script>window.privateToken="x"</script>'],
    ['serialized nested credential', '{"data":{"headers":{"authorization":"Bearer abcdefghijklmnopqrstuvwxyz012345"}}}'],
    ['double serialized credential', JSON.stringify({ body: JSON.stringify({ password: 'synthetic-password-for-audit-only' }) })]
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

  // [P1-12] Compact fixtures reject fb_dtsg, JWTs, and live oh= query tokens.
  for (const [name, payload] of [
    ['fb_dtsg object key', { data: { fb_dtsg: 'NAfSecret' } }],
    ['JWT bearer token', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart' }],
    ['live oh URL query param', { url: 'https://scontent.example.fbcdn.net/v/p.jpg?oh=00AY123liveHash&oe=6789ABCD' }]
  ]) {
    assert.throws(
      () => validateCompactFixture(makeFixture({ diagnostic: payload })),
      /Sensitive or executable data/,
      `${name} must be rejected in compact fixtures`
    );
  }

  // Negative checks for dependency-rules and i18n-check in isolated temp dirs.
  const tmpDeps = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-deps-'));
  try {
    fs.mkdirSync(path.join(tmpDeps, 'src', 'core', 'bad'), { recursive: true });
    fs.mkdirSync(path.join(tmpDeps, 'src', 'plugins', 'instagram'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDeps, 'src', 'core', 'bad', 'leak.js'),
      "import { x } from '../../plugins/instagram/x.js';\nexport default x;\n"
    );
    const depViolations = checkDependencyRules({ rootDir: tmpDeps });
    assert.ok(depViolations.length >= 1, 'core -> plugin import must be flagged by checkDependencyRules');
  } finally {
    fs.rmSync(tmpDeps, { recursive: true, force: true });
  }

  const tmpI18n = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-i18n-'));
  try {
    fs.mkdirSync(path.join(tmpI18n, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpI18n, '_locales', 'en'), { recursive: true });
    fs.mkdirSync(path.join(tmpI18n, '_locales', 'pt_BR'), { recursive: true });
    fs.writeFileSync(path.join(tmpI18n, 'src', 'app.js'), "const msg = t('missingKey');\n");
    fs.writeFileSync(path.join(tmpI18n, '_locales', 'en', 'messages.json'), JSON.stringify({ hello: { message: 'Hello $1' } }));
    fs.writeFileSync(path.join(tmpI18n, '_locales', 'pt_BR', 'messages.json'), JSON.stringify({ hello: { message: 'Oi' } }));
    const i18nErrors = checkI18nParity({ rootDir: tmpI18n });
    assert.ok(i18nErrors.some((e) => e.includes('missingKey')), 'missing referenced key must be reported');
    assert.ok(i18nErrors.some((e) => e.includes('placeholder mismatch')), 'placeholder mismatch must be reported');
  } finally {
    fs.rmSync(tmpI18n, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running compact fixture validation tests...');
  runFixtureValidationTests();
  console.log('✔ compact fixture validation tests passed.');
}
