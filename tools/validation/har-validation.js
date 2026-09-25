import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_NAMES = /^(cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|access[-_]?token|csrf(?:[-_]?token)?|xsrf(?:[-_]?token)?|password|passwd|secret|session(?:[-_]?id)?|jwt)$/i;
const SENSITIVE_TEXT = /(?:bearer\s+[a-z0-9._-]{20,}|(?:sessionid|c_user|datr|csrftoken|access_token)\s*=\s*(?![`$<])[^;\s]{20,})/i;
const MAX_STRUCTURED_JSON_CHARS = 4_000_000;
const MAX_STRUCTURED_DEPTH = 12;

export function classifyHarPath(filePath) {
  const normalized = String(filePath).replace(/[\\/]+/g, '/').toLowerCase();
  for (const platform of ['instagram', 'facebook', 'reddit']) {
    if (normalized.includes(`/${platform}/`) || normalized.includes(`www.${platform}.com`)) return platform;
  }
  return 'unknown';
}

function scanValue(value, location, findings) {
  if (typeof value === 'string' && SENSITIVE_TEXT.test(value)) findings.push(location);
}

function scanStructured(value, location, findings, depth = 0) {
  if (!value || typeof value !== 'object' || depth > MAX_STRUCTURED_DEPTH) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanStructured(entry, `${location}[${index}]`, findings, depth + 1));
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    const childLocation = `${location}.${name}`;
    if (SENSITIVE_NAMES.test(name) && !isSanitizedPlaceholder(child)) {
      findings.push(childLocation);
      scanValue(child, childLocation, findings);
    }
    scanStructured(child, childLocation, findings, depth + 1);
  }
}

function scanJsonText(text, location, findings) {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  if (trimmed.length > MAX_STRUCTURED_JSON_CHARS) {
    findings.push(location);
    return;
  }
  try { scanStructured(JSON.parse(trimmed), `${location}.$json`, findings); } catch { /* plain body */ }
}

function scanNamedPairs(pairs, location, findings) {
  if (!Array.isArray(pairs)) return;
  for (const [index, pair] of pairs.entries()) {
    const name = String(pair?.name || '');
    const value = pair?.value;
    if (SENSITIVE_NAMES.test(name) && !isSanitizedPlaceholder(value)) {
      findings.push(`${location}[${index}].${name}`);
      scanValue(value, `${location}[${index}].${name}`, findings);
    }
  }
}

function isSanitizedPlaceholder(value) {
  return typeof value === 'string' && (
    value === '' ||
    /^<(?:redacted|synthetic|fixture)>$/i.test(value) ||
    /^(?:synthetic|fixture|redacted)(?:[-_][a-z0-9]+)*$/i.test(value)
  );
}

function scanCookies(cookies, location, findings) {
  if (!Array.isArray(cookies)) return;
  for (const [index, cookie] of cookies.entries()) {
    const name = String(cookie?.name || '');
    const cookieLocation = `${location}[${index}].${name || 'value'}`;
    // HAR cookie values are credentials even when the cookie name is generic.
    // Only explicit sanitizer placeholders may remain in a publishable HAR.
    if (typeof cookie?.value === 'string' && !isSanitizedPlaceholder(cookie.value)) {
      findings.push(cookieLocation);
    }
    scanValue(cookie?.value, cookieLocation, findings);
  }
}

export function validateHarDocument(document) {
  const entries = document?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('HAR must contain log.entries');
  const findings = [];
  for (const [index, entry] of entries.entries()) {
    for (const header of [...(entry?.request?.headers || []), ...(entry?.response?.headers || [])]) {
      const headerName = String(header?.name || '');
      if (SENSITIVE_NAMES.test(headerName)) {
        findings.push(`entry[${index}].headers.${headerName}`);
        scanValue(header?.value, `entry[${index}].headers.${headerName}`, findings);
      }
    }
    const request = entry?.request || {};
    const response = entry?.response || {};
    // URLs may contain opaque CDN signatures and are not scanned as secrets.
    // Only structured query/body fields are inspected; normal response text is
    // intentionally left alone to avoid rejecting public API fixtures.
    scanNamedPairs(request.queryString, `entry[${index}].request.queryString`, findings);
    scanNamedPairs(request.postData?.params, `entry[${index}].request.postData.params`, findings);
    scanJsonText(request.postData?.text, `entry[${index}].request.postData`, findings);
    scanStructured(request.postData, `entry[${index}].request.postData`, findings);
    scanCookies(request.cookies, `entry[${index}].request.cookies`, findings);
    scanCookies(response.cookies, `entry[${index}].response.cookies`, findings);
    scanJsonText(response.content?.text, `entry[${index}].response.content`, findings);
    scanStructured(response.content, `entry[${index}].response.content`, findings);
  }
  if (findings.length) throw new Error(`sensitive HAR data found: ${findings.slice(0, 5).join(', ')}`);
  return findings;
}

export function inspectHar(document, fixture) {
  const sensitiveFindings = validateHarDocument(document);
  const entries = document.log.entries;
  const bodyBytes = entries.reduce((sum, entry) => sum + String(entry.response?.content?.text || '').length, 0);
  return {
    fixture: String(fixture).replace(/[\\/]+/g, '/'),
    platform: classifyHarPath(fixture),
    entries: entries.length,
    bodyBytes,
    sensitiveFindings
  };
}

export function inspectHarFile(filePath) {
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return inspectHar(document, filePath);
}

export function createReport(inspections) {
  return {
    schemaVersion: 1,
    fixtures: [...inspections].sort((a, b) => a.fixture.localeCompare(b.fixture))
  };
}

export function discoverHarFiles(rootDir, includePrivate = false) {
  const roots = [path.join(rootDir, 'tests', 'fixtures', 'har')];
  if (includePrivate) roots.push(path.join(rootDir, 'fixtures-private'));
  const result = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.toLowerCase().endsWith('.har')) result.push(full);
      }
    };
    walk(root);
  }
  return result.sort();
}

export function validateHarFiles(files, { allowPrivate = false } = {}) {
  const inspections = files.map((file) => {
    const normalized = String(file).replace(/[\\/]+/g, '/');
    if (allowPrivate && normalized.includes('/fixtures-private/')) {
      const document = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = document?.log?.entries;
      if (!Array.isArray(entries)) throw new Error(`HAR must contain log.entries: ${file}`);
      return {
        fixture: normalized,
        platform: classifyHarPath(file),
        entries: entries.length,
        bodyBytes: entries.reduce((sum, entry) => sum + String(entry.response?.content?.text || '').length, 0),
        sensitiveFindings: ['private-capture-not-scanned']
      };
    }
    return inspectHarFile(file);
  });
  return createReport(inspections);
}

export function validateFixtureSet(rootDir, { requirePublic = false, includePrivate = false } = {}) {
  const publicFiles = discoverHarFiles(rootDir, false);
  const privateFiles = includePrivate
    ? discoverHarFiles(rootDir, true).filter((file) => !publicFiles.includes(file))
    : [];
  if (requirePublic && publicFiles.length === 0) {
    throw new Error('No sanitized versioned HAR fixtures found under tests/fixtures/har');
  }
  if (!publicFiles.length && !privateFiles.length) {
    throw new Error(includePrivate
      ? 'No HAR fixtures found'
      : 'No public HAR fixtures found under tests/fixtures/har; pass --private only for explicit local capture validation');
  }
  const publicReport = publicFiles.length ? validateHarFiles(publicFiles) : createReport([]);
  const privateReport = privateFiles.length
    ? validateHarFiles(privateFiles, { allowPrivate: true })
    : createReport([]);
  return {
    schemaVersion: 1,
    public: publicReport.fixtures,
    private: privateReport.fixtures,
    publicFixtureCount: publicFiles.length,
    privateFixtureCount: privateFiles.length
  };
}

if (process.argv[1]?.endsWith('har-validation.js')) {
  const root = process.cwd();
  const includePrivate = process.argv.includes('--private');
  const files = discoverHarFiles(root, includePrivate);
  if (!files.length) {
    console.error('No HAR fixtures found. Validation requires at least one fixture.');
    process.exit(1);
  }
  console.log(JSON.stringify(validateHarFiles(files, { allowPrivate: includePrivate }), null, 2));
}

export { SENSITIVE_NAMES, SENSITIVE_TEXT };

// Keep imports explicit in the generated report path.
void fs;
void path;
