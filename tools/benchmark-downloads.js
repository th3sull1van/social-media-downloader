/** Offline CPU/allocation comparison. Browser/network timing is deliberately excluded.
 * Usage: bun tools/benchmark-downloads.js [baseline-ref]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DownloadManager } from '../src/core/application/DownloadManager.js';
import { StorageService } from '../src/core/services/StorageService.js';
import { createGridHarness } from '../tests/core/grid-performance.test.js';

const ref = process.argv[2] || 'HEAD';
const readBaseline = (file) => execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' });
const baselineSource = readBaseline('src/core/application/DownloadManager.js').replace(
  /from '(\.\.?\/[^']+)'/g,
  (_, specifier) => `from '${pathToFileURL(path.resolve('src/core/application', specifier)).href}'`
);
const dir = path.resolve('.artifacts/benchmark');
fs.mkdirSync(dir, { recursive: true });
const baselineFile = path.join(dir, 'DownloadManager.js');
fs.writeFileSync(baselineFile, baselineSource);
const BaselineManager = (await import(pathToFileURL(baselineFile).href)).DownloadManager;
const oldGrid = readBaseline('src/content/content.js');
const newGrid = fs.readFileSync('src/content/content.js', 'utf8');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const runtime = /** @type {any} */ (globalThis);
const originalTimeout = globalThis.setTimeout;
// Eliminate the same intentional network pacing from both CPU measurements.
runtime.setTimeout = (fn, delay, ...args) => delay === 40
  ? (queueMicrotask(() => fn(...args)), 0)
  : originalTimeout(fn, delay, ...args);

async function measureManager(Manager, count) {
  const items = Array.from({ length: count }, (_, i) => ({ id: String(i) }));
  const manager = new Manager({});
  manager.downloadItem = async () => 1;
  manager.updateBadge = () => {};
  manager.scheduleBadgeClear = () => {};
  let peak = process.memoryUsage().heapUsed;
  let updates = 0;
  manager.broadcastProgress = () => {
    if (++updates % 128 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
  };
  const initial = process.memoryUsage().heapUsed;
  const cpu = process.cpuUsage();
  const start = performance.now();
  await manager.processIndividualDownloads(null, 'test', 'test', items);
  const elapsedMs = performance.now() - start;
  const used = process.cpuUsage(cpu);
  if (manager.activeJob.completed !== count) throw new Error('Incomplete benchmark job');
  return { elapsedMs, cpuMs: (used.user + used.system) / 1000, sampledHeapGrowthMiB: Math.max(0, peak - initial) / 1048576 };
}

function measureGrid(source, count) {
  const ui = createGridHarness(source);
  for (let i = 0; i < count; i++) ui.state.media.set(String(i), {
    id: String(i), type: 'image', url: 'https://example.com/image.jpg', width: 100, height: 100
  });
  ui.render();
  const initial = ui.created;
  ui.state.selectedIds = new Set(ui.state.media.keys());
  const start = performance.now();
  ui.select();
  return { elapsedMs: performance.now() - start, createdNodes: ui.created - initial };
}

const report = { baseline: ref, runtime: process.versions, note: 'Offline doubles; sampled heap is not browser peak memory.', downloads: [], grid: [] };
try {
  for (const count of [1000, 10000]) {
    for (const [version, Manager, source] of [['before', BaselineManager, oldGrid], ['after', DownloadManager, newGrid]]) {
      await measureManager(Manager, count); // warm up
      const runs = [];
      for (let i = 0; i < 5; i++) {
        runtime.Bun?.gc(true);
        runs.push(await measureManager(Manager, count));
      }
      report.downloads.push({ count, version,
        elapsedMs: median(runs.map((r) => r.elapsedMs)), cpuMs: median(runs.map((r) => r.cpuMs)),
        sampledHeapGrowthMiB: median(runs.map((r) => r.sampledHeapGrowthMiB)) });
      const gridRuns = [];
      for (let i = 0; i < 5; i++) gridRuns.push(measureGrid(source, count));
      report.grid.push({ count, version, elapsedMs: median(gridRuns.map((r) => r.elapsedMs)), createdNodes: median(gridRuns.map((r) => r.createdNodes)) });
    }
  }
  const originalGet = StorageService.get;
  let reads = 0;
  StorageService.get = async () => { reads++; return Array.from({ length: 50000 }, (_, i) => `signature-${i}`); };
  try {
    for (let i = 0; i < 1000; i++) await StorageService.isHistoricallyDownloaded('missing');
    const before = reads;
    reads = 0;
    const snapshot = await StorageService.getHistorySnapshot();
    for (let i = 0; i < 1000; i++) snapshot.signatures.has('missing');
    report['historyReadsFor1000Items'] = { before, after: reads };
  } finally { StorageService.get = originalGet; }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { globalThis.setTimeout = originalTimeout; }
