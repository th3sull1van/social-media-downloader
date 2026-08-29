/**
 * Social Media Downloader — Locale Synchronizer
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const destLocalesDir = path.join(rootDir, '_locales');

const enPath = path.join(destLocalesDir, 'en', 'messages.json');
if (fs.existsSync(enPath)) {
  const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const locales = fs.readdirSync(destLocalesDir).filter((f) => {
    return fs.statSync(path.join(destLocalesDir, f)).isDirectory();
  });

  for (const loc of locales) {
    if (loc === 'en') continue;
    const locPath = path.join(destLocalesDir, loc, 'messages.json');
    if (!fs.existsSync(locPath)) continue;
    const locMessages = JSON.parse(fs.readFileSync(locPath, 'utf8'));
    let modified = false;
    for (const [k, v] of Object.entries(enMessages)) {
      if (!locMessages[k]) {
        locMessages[k] = v;
        modified = true;
      }
    }
    if (modified) {
      fs.writeFileSync(locPath, JSON.stringify(locMessages, null, 2), 'utf8');
    }
  }

  console.log(`Verified and synchronized ${locales.length} locales with en base.`);
}
