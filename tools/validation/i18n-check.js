/**
 * Social Media Downloader — i18n Parity Validator
 * Validates that all 22 locale files are well-formed and maintain 100% key, usage, and placeholder parity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '../..');

function collectFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...collectFiles(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

function collectUsedMessageKeys(rootDir) {
  const used = new Set();
  const srcFiles = collectFiles(path.join(rootDir, 'src'), ['.js', '.html']);
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-title)?\s*=\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1]);
    for (const m of text.matchAll(/labelKey\s*:\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1]);
  }
  const manifestPath = path.join(rootDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const mText = fs.readFileSync(manifestPath, 'utf8');
    for (const m of mText.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  }
  return used;
}

/** @param {{ rootDir?: string }} [options] */
export function checkI18nParity({ rootDir: suppliedRootDir } = {}) {
  const rootDir = suppliedRootDir || defaultRootDir;
  const localesDir = path.join(rootDir, '_locales');
  const errors = [];
  if (!fs.existsSync(localesDir)) {
    return ['_locales directory does not exist'];
  }

  const locales = fs.readdirSync(localesDir).filter(f => fs.statSync(path.join(localesDir, f)).isDirectory());
  const expectedLocalesCount = 22;

  if (!suppliedRootDir && locales.length < expectedLocalesCount) {
    errors.push(`Expected at least ${expectedLocalesCount} locales, found ${locales.length}`);
  }

  const enPath = path.join(localesDir, 'en', 'messages.json');
  if (!fs.existsSync(enPath)) {
    return ['Base locale en/messages.json missing'];
  }

  const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const enKeys = Object.keys(enMessages);
  const enKeySet = new Set(enKeys);

  // Verify default_locale in manifest (pt_BR) and all referenced keys in src/ + manifest.json
  const manifestPath = path.join(rootDir, 'manifest.json');
  const defaultLocale = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).default_locale || 'en')
    : 'en';
  const defaultLocPath = path.join(localesDir, defaultLocale, 'messages.json');
  const defaultMessages = fs.existsSync(defaultLocPath)
    ? JSON.parse(fs.readFileSync(defaultLocPath, 'utf8'))
    : enMessages;
  const usedKeys = collectUsedMessageKeys(rootDir);
  for (const key of usedKeys) {
    if (!(key in defaultMessages)) {
      errors.push(`Referenced i18n key "${key}" is missing in default_locale (${defaultLocale})`);
    }
    if (!(key in enMessages)) {
      errors.push(`Referenced i18n key "${key}" is missing in en`);
    }
  }
  const unusedKeys = enKeys.filter((key) => !usedKeys.has(key));
  if (unusedKeys.length > 0) {
    errors.push(`Unused i18n keys in en/messages.json (${unusedKeys.length}): ${unusedKeys.slice(0, 8).join(', ')}`);
  }

  for (const loc of locales) {
    const locPath = path.join(localesDir, loc, 'messages.json');
    if (!fs.existsSync(locPath)) {
      errors.push(`Locale file missing: ${loc}/messages.json`);
      continue;
    }

    let messages;
    try {
      messages = JSON.parse(fs.readFileSync(locPath, 'utf8'));
    } catch (e) {
      errors.push(`Locale file ${loc}/messages.json contains invalid JSON: ${e.message}`);
      continue;
    }

    const locKeys = Object.keys(messages);
    const missingKeys = enKeys.filter(k => !(k in messages));
    if (missingKeys.length > 0) {
      errors.push(`Locale ${loc} is missing ${missingKeys.length} keys: ${missingKeys.slice(0, 5).join(', ')}...`);
    }
    const extraKeys = locKeys.filter(k => !enKeySet.has(k));
    if (extraKeys.length > 0) {
      errors.push(`Locale ${loc} has ${extraKeys.length} extra keys not in en: ${extraKeys.slice(0, 5).join(', ')}`);
    }

    // Check non-empty messages & placeholder parity
    for (const key of enKeys) {
      if (!messages[key]) continue;
      const enMsg = enMessages[key].message || '';
      const locMsg = messages[key].message || '';
      if (!String(locMsg).trim()) {
        errors.push(`Locale ${loc} has empty message for "${key}"`);
      }

      const enPlaceholders = (enMsg.match(/\$\d+/g) || []).sort();
      const locPlaceholders = (locMsg.match(/\$\d+/g) || []).sort();

      if (enPlaceholders.join(',') !== locPlaceholders.join(',')) {
        errors.push(`Locale ${loc} has placeholder mismatch on "${key}": expected [${enPlaceholders.join(',')}], got [${locPlaceholders.join(',')}]`);
      }
    }
  }

  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('Validating 22 Locales key parity and placeholder integrity...');
  const errors = checkI18nParity();
  if (errors.length === 0) {
    console.log('\x1b[32m✔ All 22 locales verified with 100% key and placeholder parity (0 errors).\x1b[0m');
  } else {
    console.error(`\x1b[31m✖ i18n validation failed with ${errors.length} errors:\x1b[0m`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}
