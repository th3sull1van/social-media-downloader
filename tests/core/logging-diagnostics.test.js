/**
 * Social Media Downloader — Logging Unit Tests
 */
import assert from 'node:assert';
import { Logger } from '../../src/core/services/LoggingService.js';

export async function runLoggingDiagnosticsTests() {
  // 1. Logger sanitization
  const sensitiveString = 'https://example.com/api?fb_dtsg=NAf12345&token=secret_abc';
  const cleanString = /** @type {string} */ (Logger.sanitize(sensitiveString));
  assert.ok(!cleanString.includes('NAf12345'));
  assert.ok(cleanString.includes('<REDACTED>'));

  // 1b. Errors must be preserved with their message (previously logged as {}).
  {
    const err = new Error('HTTP 403 when fetching media');
    const cleanErr = /** @type {any} */ (Logger.sanitize(err));
    assert.strictEqual(cleanErr.name, 'Error');
    assert.strictEqual(cleanErr.message, 'HTTP 403 when fetching media');
    // Stack points at the creation site (this test file), truncated to 3 lines.
    assert.ok(typeof cleanErr.stack === 'string' && cleanErr.stack.includes('logging-diagnostics.test.js'));
  }

  const sensitiveObj = {
    username: 'test_user',
    fb_dtsg: 'super_secret',
    nested: {
      password: 'mypassword123',
      normal: 'value'
    }
  };
  const cleanObj = /** @type {any} */ (Logger.sanitize(sensitiveObj));
  assert.strictEqual(cleanObj.fb_dtsg, '<REDACTED>');
  assert.strictEqual(cleanObj.nested.password, '<REDACTED>');
  assert.strictEqual(cleanObj.nested.normal, 'value');
}
