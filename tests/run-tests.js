/**
 * Social Media Downloader — Master Automated Test Runner
 */
import { checkI18nParity } from '../tools/validation/i18n-check.js';
import { checkManifestIntegrity } from '../tools/validation/manifest-check.js';
import { checkDependencyRules } from '../tools/validation/dependency-rules.js';
import { runDomainTests } from './core/domain.test.js';
import { runFilenameTests } from './core/filename.test.js';
import { runLoggingDiagnosticsTests } from './core/logging-diagnostics.test.js';
import { runDownloadManagerTests } from './core/download-manager.test.js';
import { runContractTests } from './contracts/contracts.test.js';
import { runInstagramNamingTests } from './contracts/instagram-naming.test.js';
import { runFacebookNamingTests } from './contracts/facebook-naming.test.js';
import { runRedditNamingTests } from './contracts/reddit-naming.test.js';
import { runRedditMessageRoutingTests } from './contracts/reddit-message-routing.test.js';
import { runPipelineTests } from './integration/pipeline.test.js';
import { runHarExtractionTests } from './integration/har-extraction.test.js';
import { runHarReplayTests } from './integration/har-replay.test.js';
import { runHarPlatformReplayTests } from './integration/har-replay-platforms.test.js';
import { runFbFullResTests } from './integration/fb-fullres.test.js';
import { runIgFullResTests } from './integration/ig-fullres.test.js';
import { runRedditFullResTests } from './integration/reddit-fullres.test.js';
import { runHarCompareTests } from './integration/har-compare.test.js';
import { runHarValidationUnitTests } from './validation/har-validation.test.js';
import { compareReports } from '../tools/har-compare.js';
import { runRedditScannerTests } from './reddit/scanner.test.js';
import { runMuxerTests, runRedGifsTests } from './reddit/muxer-redgifs.test.js';
import { discoverHarFiles, validateHarFiles } from '../tools/validation/har-validation.js';

const suites = [
  {
    name: 'i18n & 22 Locales Parity Tests',
    fn: async () => {
      const errs = checkI18nParity();
      if (errs.length > 0) throw new Error(errs.join('\n'));
    }
  },
  {
    name: 'Manifest V3 Integrity & Path Tests',
    fn: async () => {
      const errs = checkManifestIntegrity();
      if (errs.length > 0) throw new Error(errs.join('\n'));
    }
  },
  {
    name: 'Architectural Dependency Rules Enforcement',
    fn: async () => {
      const violations = checkDependencyRules();
      if (violations.length > 0) throw new Error(`${violations.length} dependency violations`);
    }
  },
  {
    name: 'Core Domain Model & Error Tests',
    fn: runDomainTests
  },
  {
    name: 'Download Manager & chrome.* Stub Tests',
    fn: runDownloadManagerTests
  },
  {
    name: 'Reddit Scanner (JSON API) Tests',
    fn: runRedditScannerTests
  },
  {
    name: 'Reddit Video Muxer & RedGifs Resolver Tests',
    fn: async () => {
      await runMuxerTests();
      await runRedGifsTests();
    }
  },
  {
    name: 'Filename Sanitization & Traversal Prevention Tests',
    fn: runFilenameTests
  },
  {
    name: 'Logging, Secret Sanitization & Diagnostics Tests',
    fn: runLoggingDiagnosticsTests
  },
  {
    name: 'Platform Plugin Contract Tests (Instagram, Facebook, Reddit)',
    fn: runContractTests
  },
  {
    name: 'Instagram Naming Conventions (video token guard)',
    fn: runInstagramNamingTests
  },
  {
    name: 'Facebook Naming Conventions (authentic CDN basenames)',
    fn: runFacebookNamingTests
  },
  {
    name: 'Reddit Naming Conventions (media id + path traversal guard)',
    fn: runRedditNamingTests
  },
  {
    name: 'Reddit Message Routing (plugin claims only Reddit-owned message types)',
    fn: runRedditMessageRoutingTests
  },
  {
    name: 'End-to-End Multi-Platform Pipeline Tests',
    fn: runPipelineTests
  },
  {
    name: 'HAR Replay: Instagram GraphQL Media Extraction',
    fn: runHarExtractionTests
  },
  {
    name: 'HAR Replay: Instagram Content-Script VM Parity & Nonce Gate',
    fn: runHarReplayTests
  },
  {
    name: 'HAR Replay: Facebook & Reddit Platform Scanners (real fixtures)',
    fn: runHarPlatformReplayTests
  },
  {
    name: 'HAR Replay: Instagram Full-Resolution Extraction Tests',
    fn: async () => {
      runIgFullResTests();
    }
  },
  {
    name: 'HAR Replay: Facebook Full-Resolution Extraction Tests',
    fn: async () => {
      await runFbFullResTests();
    }
  },
  {
    name: 'HAR Replay: Reddit Full-Resolution Extraction Tests',
    fn: async () => {
      await runRedditFullResTests();
    }
  },
  {
    name: 'HAR Fixture Inventory (private captures)',
    fn: async () => {
      const files = discoverHarFiles(process.cwd());
      if (files.length === 0) throw new Error('No HAR fixtures found');
      const report = validateHarFiles(files, { allowPrivate: true });
      if (report.fixtures.length !== files.length) throw new Error('HAR inventory is incomplete');
    }
  },
  {
    name: 'HAR Validation & Sanitization Rules Tests',
    fn: async () => {
      runHarValidationUnitTests();
    }
  },
  {
    name: 'HAR Report Deterministic Comparison Tests',
    fn: async () => {
      runHarCompareTests();
    }
  },
  {
    name: 'HAR Baseline Comparison',
    fn: async () => {
      const reportPath = '.artifacts/har-report.json';
      const baselinePath = 'tests/fixtures/har/expected/baseline.json';
      const fs = await import('node:fs');
      if (!fs.existsSync(reportPath) || !fs.existsSync(baselinePath)) return;
      const actual = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const expected = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      const differences = compareReports(actual, expected);
      if (differences.length > 0) throw new Error(`HAR baseline mismatch: ${differences.length} fixture(s)`);
    }
  }
];

async function main() {
  console.log('====================================================');
  console.log('  AUTOMATED TEST SUITE — SOCIAL MEDIA DOWNLOADER');
  console.log('====================================================\n');

  let passedSuites = 0;
  const startTime = Date.now();

  for (const suite of suites) {
    process.stdout.write(`• Running: ${suite.name}... `);
    try {
      await suite.fn();
      console.log('\x1b[32m[PASSED]\x1b[0m');
      passedSuites++;
    } catch (err) {
      console.log('\x1b[31m[FAILED]\x1b[0m');
      console.error(err);
      process.exitCode = 1;
    }
  }

  const duration = Date.now() - startTime;
  console.log('\n----------------------------------------------------');
  console.log(`Result: ${passedSuites}/${suites.length} test suites passed in ${duration}ms.`);
  console.log('====================================================');

  if (passedSuites === suites.length) {
    console.log('\x1b[32mALL TEST SUITES PASSED SUCCESSFULLY!\x1b[0m\n');
  } else {
    console.log('\x1b[31mSOME TEST SUITES FAILED.\x1b[0m\n');
  }
}

main();
