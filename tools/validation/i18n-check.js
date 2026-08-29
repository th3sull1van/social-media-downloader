/**
 * Social Media Downloader — i18n Parity Validator
 * Validates that all 22 locale files are well-formed and maintain 100% key and placeholder parity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const localesDir = path.join(rootDir, '_locales');

export function checkI18nParity() {
  const errors = [];
  if (!fs.existsSync(localesDir)) {
    return ['_locales directory does not exist'];
  }

  const locales = fs.readdirSync(localesDir).filter(f => fs.statSync(path.join(localesDir, f)).isDirectory());
  const expectedLocalesCount = 22;

  if (locales.length < expectedLocalesCount) {
    errors.push(`Expected at least ${expectedLocalesCount} locales, found ${locales.length}`);
  }

  const enPath = path.join(localesDir, 'en', 'messages.json');
  if (!fs.existsSync(enPath)) {
    return ['Base locale en/messages.json missing'];
  }

  const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const enKeys = Object.keys(enMessages);

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

    const missingKeys = enKeys.filter(k => !(k in messages));
    if (missingKeys.length > 0) {
      errors.push(`Locale ${loc} is missing ${missingKeys.length} keys: ${missingKeys.slice(0, 5).join(', ')}...`);
    }

    // Check placeholder parity
    for (const key of enKeys) {
      if (!messages[key]) continue;
      const enMsg = enMessages[key].message || '';
      const locMsg = messages[key].message || '';

      const enPlaceholders = (enMsg.match(/\$\d+/g) || []).sort();
      const locPlaceholders = (locMsg.match(/\$\d+/g) || []).sort();

      if (enPlaceholders.join(',') !== locPlaceholders.join(',')) {
        errors.push(`Locale ${loc} has placeholder mismatch on "${key}": expected [${enPlaceholders.join(',')}], got [${locPlaceholders.join(',')}]`);
      }
    }
  }

  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
