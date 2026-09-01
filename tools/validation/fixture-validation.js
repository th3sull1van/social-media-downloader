import fs from 'node:fs';
import path from 'node:path';
import { COMPACT_FIXTURE_VERSION, discoverCompactFixtures } from '../fixture-replay.js';

const SENSITIVE_KEY = /(?:cookie|set[-_]?cookie|authorization|proxy[-_]?authorization|access[-_]?token|csrf|xsrf|password|passwd|secret|session(?:[-_]?id)?|jwt)/i;
const SENSITIVE_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]{20,}|(?:sessionid|c_user|datr|csrftoken|access_token)\s*=\s*(?![`$<])[^;\s]{12,})/i;
const PRIVATE_URL_VALUE = /(?:[?&](?:access_token|authorization|cookie|sessionid|csrftoken|sig(?:nature)?|token)=)(?!fixture|synthetic|redacted)/i;
const FORBIDDEN_HTML = /<script\b|<iframe\b|<object\b|javascript:/i;

const ALLOWED_TYPES = new Set([
  'instagram-replay',
  'facebook-replay',
  'reddit-replay',
  'reddit-api'
]);

/**
 * @param {any} value
 * @param {string} location
 * @param {string[]} findings
 */
function scanValue(value, location, findings) {
  if (typeof value !== 'string') return;
  if (SENSITIVE_VALUE.test(value)) findings.push(location);
  if (PRIVATE_URL_VALUE.test(value)) findings.push(location);
  if (FORBIDDEN_HTML.test(value)) findings.push(location);
}

/**
 * @param {any} value
 * @param {string} location
 * @param {string[]} findings
 */
function scanTree(value, location, findings) {
  if (typeof value === 'string') {
    scanValue(value, location, findings);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanTree(entry, `${location}[${index}]`, findings));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (SENSITIVE_KEY.test(key)) findings.push(childLocation);
    scanTree(child, childLocation, findings);
  }
}

/**
 * Validates one compact fixture.  This deliberately scans every output value;
 * unlike the private HAR inventory, it must be safe to commit.
 *
 * @param {any} fixture
 * @param {string} [fixturePath='fixture']
 * @returns {{ fixture: string, platform: string, fixtureType: string, sourceCaptureId: string, bytes?: number, sensitiveFindings: string[], records: number }}
 */
export function validateCompactFixture(fixture, fixturePath = 'fixture') {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new Error(`Compact fixture must be an object: ${fixturePath}`);
  }
  if (fixture.fixtureVersion !== COMPACT_FIXTURE_VERSION) {
    throw new Error(`Unsupported compact fixture version in ${fixturePath}: ${fixture.fixtureVersion}`);
  }
  if (fixture.extractionVersion !== 1 || fixture.sanitizationVersion !== 1) {
    throw new Error(`Compact fixture extraction/sanitization version is unsupported: ${fixturePath}`);
  }
  if (!fixture.platform || !['instagram', 'facebook', 'reddit'].includes(fixture.platform)) {
    throw new Error(`Compact fixture has an invalid platform: ${fixturePath}`);
  }
  if (!ALLOWED_TYPES.has(fixture.fixtureType)) {
    throw new Error(`Compact fixture has an invalid fixtureType: ${fixturePath}`);
  }
  if (fixture.sanitized !== true) {
    throw new Error(`Compact fixture must be marked sanitized: ${fixturePath}`);
  }
  if (!fixture.sourceCaptureId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(String(fixture.sourceCaptureId))) {
    throw new Error(`Compact fixture must use a safe synthetic sourceCaptureId: ${fixturePath}`);
  }

  /** @type {string[]} */
  const findings = [];
  scanTree(fixture, '$', findings);
  if (findings.length > 0) {
    throw new Error(`Sensitive or executable data found in compact fixture ${fixturePath}: ${findings.slice(0, 8).join(', ')}`);
  }

  const recordArrays = ['nodes', 'storyItems', 'posts', 'graphqlBodies', 'jsonScripts', 'htmlPages', 'cdnRequests', 'reelPayloads'];
  const records = recordArrays.reduce((sum, key) => sum + (Array.isArray(fixture[key]) ? fixture[key].length : 0), 0);
  return {
    fixture: String(fixturePath).replace(/[\\/]+/g, '/'),
    platform: fixture.platform,
    fixtureType: fixture.fixtureType,
    sourceCaptureId: String(fixture.sourceCaptureId),
    sensitiveFindings: [],
    records
  };
}

/**
 * @param {string[]} files
 * @returns {{ schemaVersion: number, fixtures: Array<Record<string, any>>, totalBytes: number }}
 */
export function validateCompactFiles(files) {
  const fixtures = files.map((filePath) => {
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = validateCompactFixture(fixture, filePath);
    return {
      ...result,
      bytes: fs.statSync(filePath).size
    };
  });
  return {
    schemaVersion: 1,
    fixtures: fixtures.sort((a, b) => a.fixture.localeCompare(b.fixture)),
    totalBytes: fixtures.reduce((sum, fixture) => sum + fixture.bytes, 0)
  };
}

/**
 * The manifest is generated metadata, but it is committed alongside the
 * fixtures and must not become a way to leak a local path or stale inventory.
 * @param {string} rootDir
 * @param {string[]} files
 * @param {ReturnType<typeof validateCompactFiles>} report
 */
function validateCompactManifest(rootDir, files, report) {
  const fixtureRoot = path.join(rootDir, 'tests', 'fixtures', 'extracted');
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Compact fixture manifest is missing: ${manifestPath}`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Compact fixture manifest is invalid JSON: ${manifestPath}: ${error?.message || error}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Compact fixture manifest must be an object: ${manifestPath}`);
  }
  if (manifest.manifestVersion !== 1 || manifest.sanitized !== true || !Array.isArray(manifest.fixtures)) {
    throw new Error(`Compact fixture manifest metadata is invalid: ${manifestPath}`);
  }

  /** @type {string[]} */
  const findings = [];
  scanTree(manifest, '$.manifest', findings);
  if (findings.length > 0) {
    throw new Error(`Sensitive or executable data found in compact fixture manifest: ${findings.slice(0, 8).join(', ')}`);
  }

  const reportByPath = new Map(report.fixtures.map((entry) => [entry.fixture, entry]));
  const expected = new Map(files.map((filePath) => {
    const relativePath = path.relative(fixtureRoot, filePath).replace(/[\\/]+/g, '/');
    const absolutePath = filePath.replace(/[\\/]+/g, '/');
    return [relativePath, reportByPath.get(absolutePath)];
  }));
  const actualPaths = new Set();
  for (const entry of manifest.fixtures) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Compact fixture manifest contains an invalid entry: ${manifestPath}`);
    }
    const relativePath = String(entry.path || '');
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('..') || relativePath.includes('\\') || relativePath.includes(':')) {
      throw new Error(`Compact fixture manifest contains an unsafe path: ${relativePath}`);
    }
    if (actualPaths.has(relativePath)) throw new Error(`Compact fixture manifest contains a duplicate path: ${relativePath}`);
    actualPaths.add(relativePath);
    const expectedEntry = expected.get(relativePath);
    if (!expectedEntry) throw new Error(`Compact fixture manifest references an unknown fixture: ${relativePath}`);
    if (entry.bytes !== expectedEntry.bytes || entry.platform !== expectedEntry.platform ||
        entry.fixtureType !== expectedEntry.fixtureType || entry.sourceCaptureId !== expectedEntry.sourceCaptureId) {
      throw new Error(`Compact fixture manifest is stale for ${relativePath}`);
    }
  }
  if (manifest.fixtures.length !== files.length || actualPaths.size !== expected.size) {
    throw new Error(`Compact fixture manifest inventory is incomplete: ${manifestPath}`);
  }
  if (manifest.totalBytes !== report.totalBytes) {
    throw new Error(`Compact fixture manifest totalBytes is stale: ${manifestPath}`);
  }
}

/**
 * @param {string} rootDir
 * @returns {ReturnType<typeof validateCompactFiles>}
 */
export function validateCompactFixtureSet(rootDir) {
  const files = discoverCompactFixtures(rootDir);
  if (files.length === 0) throw new Error('No compact fixtures found under tests/fixtures/extracted');
  const report = validateCompactFiles(files);
  validateCompactManifest(rootDir, files, report);
  return report;
}
