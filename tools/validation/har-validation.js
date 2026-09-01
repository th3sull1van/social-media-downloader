import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_NAMES = /^(cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token)$/i;
const SENSITIVE_TEXT = /(?:bearer\s+[a-z0-9._-]{20,}|(?:sessionid|c_user|datr|csrftoken|access_token)\s*=\s*(?![`$<])[^;\s]{20,})/i

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
    // URLs may contain opaque CDN signatures and are not scanned as secrets.
    // Response bodies can contain source-code strings such as `SessionId`;
    // credentials are checked in transport headers and request metadata instead.
    scanValue(entry?.request?.postData?.text, `entry[${index}].request.postData`, findings);
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
