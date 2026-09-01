/**
 * Shared test-suite catalog.
 *
 * The catalog is deliberately data-driven so the serial runner and the
 * process-isolated parallel runner execute exactly the same suites.
 */
import { checkI18nParity } from '../tools/validation/i18n-check.js';
import { checkManifestIntegrity } from '../tools/validation/manifest-check.js';
import { checkDependencyRules } from '../tools/validation/dependency-rules.js';
import { runDomainTests } from './core/domain.test.js';
import { runFilenameTests } from './core/filename.test.js';
import { runLoggingDiagnosticsTests } from './core/logging-diagnostics.test.js';
import { runDownloadManagerTests } from './core/download-manager.test.js';
import { runStorageDedupTests } from './core/storage-dedup.test.js';
import { runZipIntegrityTests } from './core/zip-integrity.test.js';
import { runOffscreenZipTests } from './core/offscreen-zip.test.js';
import { runContractTests } from './contracts/contracts.test.js';
import { runInstagramNamingTests } from './contracts/instagram-naming.test.js';
import { runFacebookNamingTests } from './contracts/facebook-naming.test.js';
import { runRedditNamingTests } from './contracts/reddit-naming.test.js';
import { runRedditMessageRoutingTests } from './contracts/reddit-message-routing.test.js';
import { runPipelineTests } from './integration/pipeline.test.js';
import { runHarExtractionTests } from './integration/har-extraction.test.js';
import { runCompactInstagramReplayTests } from './integration/fixture-replay.test.js';
import { runCompactPlatformReplayTests } from './integration/har-replay-platforms.test.js';
import { runAvatarReplayTests } from './integration/avatar-replay.test.js';
import { runFbFullResTests } from './integration/fb-fullres.test.js';
import { runIgFullResTests } from './integration/ig-fullres.test.js';
import { runRedditFullResTests } from './integration/reddit-fullres.test.js';
import { runHarCompareTests } from './integration/har-compare.test.js';
import { runHarValidationUnitTests } from './validation/har-validation.test.js';
import { runFixtureValidationTests } from './validation/fixture-validation.test.js';
import { runRedditScannerTests } from './reddit/scanner.test.js';
import { runMuxerTests, runRedGifsTests } from './reddit/muxer-redgifs.test.js';
import { validateCompactFixtureSet } from '../tools/validation/fixture-validation.js';

function passingValidation(check, message) {
  return async () => {
    const errors = check();
    if (errors.length > 0) throw new Error(message(errors));
  };
}

export const suites = [
  {
    id: 'i18n-parity',
    name: 'i18n & 22 Locales Parity Tests',
    fn: passingValidation(checkI18nParity, (errors) => errors.join('\n'))
  },
  {
    id: 'manifest-integrity',
    name: 'Manifest V3 Integrity & Path Tests',
    fn: passingValidation(checkManifestIntegrity, (errors) => errors.join('\n'))
  },
  {
    id: 'dependency-rules',
    name: 'Architectural Dependency Rules Enforcement',
    fn: passingValidation(checkDependencyRules, (violations) => `${violations.length} dependency violations`)
  },
  { id: 'core-domain', name: 'Core Domain Model & Error Tests', fn: runDomainTests },
  { id: 'download-manager', name: 'Download Manager & chrome.* Stub Tests', fn: runDownloadManagerTests },
  { id: 'storage-dedup', name: 'Storage & Exact/Historical Deduplication Tests', fn: runStorageDedupTests },
  { id: 'zip-integrity', name: 'ZIP Integrity & PKZIP 2.0 Compliance Tests', fn: runZipIntegrityTests },
  { id: 'offscreen-zip', name: 'Offscreen OPFS ZIP Streaming Tests', fn: runOffscreenZipTests },
  { id: 'reddit-scanner', name: 'Reddit Scanner (JSON API) Tests', fn: runRedditScannerTests },
  {
    id: 'reddit-muxer-redgifs',
    name: 'Reddit Video Muxer & RedGifs Resolver Tests',
    fn: async () => {
      await runMuxerTests();
      await runRedGifsTests();
    }
  },
  { id: 'filename', name: 'Filename Sanitization & Traversal Prevention Tests', fn: runFilenameTests },
  { id: 'logging-diagnostics', name: 'Logging, Secret Sanitization & Diagnostics Tests', fn: runLoggingDiagnosticsTests },
  { id: 'plugin-contracts', name: 'Platform Plugin Contract Tests (Instagram, Facebook, Reddit)', fn: runContractTests },
  { id: 'instagram-naming', name: 'Instagram Naming Conventions (video token guard)', fn: runInstagramNamingTests },
  { id: 'facebook-naming', name: 'Facebook Naming Conventions (authentic CDN basenames)', fn: runFacebookNamingTests },
  { id: 'reddit-naming', name: 'Reddit Naming Conventions (media id + path traversal guard)', fn: runRedditNamingTests },
  { id: 'reddit-message-routing', name: 'Reddit Message Routing (plugin claims only Reddit-owned message types)', fn: runRedditMessageRoutingTests },
  { id: 'pipeline', name: 'End-to-End Multi-Platform Pipeline Tests', fn: runPipelineTests },
  { id: 'har-extraction', name: 'Compact Fixture: Instagram GraphQL Media Extraction', fn: runHarExtractionTests },
  { id: 'fixture-replay', name: 'Compact Fixture: Instagram Content-Script VM Parity & Nonce Gate', fn: runCompactInstagramReplayTests },
  { id: 'platform-fixture-replay', name: 'Compact Fixture: Facebook & Reddit Platform Scanners', fn: runCompactPlatformReplayTests },
  { id: 'avatar-replay', name: 'Compact Fixture: Facebook & Reddit Target Avatars', fn: runAvatarReplayTests },
  { id: 'instagram-full-resolution', name: 'Compact Fixture: Instagram Full-Resolution Extraction Tests', fn: runIgFullResTests },
  { id: 'facebook-full-resolution', name: 'Compact Fixture: Facebook Full-Resolution Extraction Tests', fn: runFbFullResTests },
  { id: 'reddit-full-resolution', name: 'Compact Fixture: Reddit Full-Resolution Extraction Tests', fn: runRedditFullResTests },
  {
    id: 'compact-fixture-validation',
    name: 'Compact Fixture Security & Metadata Validation',
    fn: async () => {
      const report = validateCompactFixtureSet(process.cwd());
      if (report.fixtures.length === 0) throw new Error('No compact fixtures found');
    }
  },
  { id: 'har-validation', name: 'HAR Validation & Sanitization Rules Tests', fn: runHarValidationUnitTests },
  { id: 'fixture-validation', name: 'Compact Fixture Sanitization Rules Tests', fn: runFixtureValidationTests },
  { id: 'har-compare', name: 'HAR Report Deterministic Comparison Tests', fn: runHarCompareTests },
];

export function getSuite(id) {
  return suites.find((suite) => suite.id === id);
}
