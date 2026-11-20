// Benchmarks: 1M indexed height queries vs brute baseline, manifold throughput.
// Writes bench/result.json. Warmup 2, samples 7, cold start recorded separately.
import { readFileSync, writeFileSync } from 'node:fs';
import * as core from '../src/core.mjs';
import { bruteSurface } from '../baseline/naive.mjs';

const t0 = performance.now();
const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const terrain = core.buildTerrain(data.terrain);
const coldStartMs = performance.now() - t0; // import + data load + terrain build

let seed = 0x51ed;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const N = 1000000;
const xs = new Int32Array(N), zs = new Int32Array(N);
for (let i = 0; i < N; i++) { xs[i] = Math.floor(rnd() * 12000); zs[i] = Math.floor(rnd() * 12000); }

function gridPass() {
  let tests = 0, hits = 0;
  for (let i = 0; i < N; i++) {
    const s = core.surfaceAt(terrain, xs[i], zs[i]);
    tests += 2;
    if (s.inside) hits++;
  }
  return { tests, hits };
}

const BQ = 2000;
const bxs = xs.slice(0, BQ), bzs = zs.slice(0, BQ);
function brutePass() {
  let tests = 0, hits = 0;
  for (let i = 0; i < BQ; i++) {
    const r = bruteSurface(terrain.tris, terrain.cell, terrain.cols, terrain.rows, bxs[i], bzs[i]);
    tests += r.tested; if (r.inside) hits++;
  }
  return { tests, hits };
}

const frames = data.scenes.flatMap(s => s.frames);
function manifoldPass() {
  let valid = 0;
  for (const fr of frames) {
    const c = core.contactsFor(terrain, fr.center, fr.half);
    const m = core.buildManifold(c.contacts, [fr.center[0], fr.center[2]]);
    if (m.valid) valid++;
  }
  return { valid };
}

const stats = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const min = s[0], max = s[s.length - 1];
  const median = s[Math.floor(s.length / 2)];
  const p95 = s[Math.ceil(0.95 * s.length) - 1];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const stddev = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { min, median, p95, max, stddev, rsd: stddev / mean };
};

// warmup (2) then 7 measured samples
for (let i = 0; i < 2; i++) { gridPass(); brutePass(); manifoldPass(); }
const samples = { gridMs: [], bruteMs: [], manifoldMs: [], gridTests: [], bruteTests: [] };
let lastGrid = null, lastBrute = null;
for (let i = 0; i < 7; i++) {
  let a = performance.now(); lastGrid = gridPass(); samples.gridMs.push(performance.now() - a);
  a = performance.now(); lastBrute = brutePass(); samples.bruteMs.push(performance.now() - a);
  a = performance.now(); manifoldPass(); samples.manifoldMs.push(performance.now() - a);
  samples.gridTests.push(lastGrid.tests); samples.bruteTests.push(lastBrute.tests);
}

const g = stats(samples.gridMs), b = stats(samples.bruteMs), m = stats(samples.manifoldMs);
const bruteProjectedTests = N * terrain.tris.length;
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  samples: 7, warmup: 2, coldStartMs: +coldStartMs.toFixed(3),
  coldStartNote: 'process start -> terrain built; does not include the 2 warmups',
  mesh: { triangles: terrain.tris.length, vertices: terrain.heights.length, cells: terrain.cols * terrain.rows },
  queries: N,
  grid: { medianMs: +g.median.toFixed(2), minMs: +g.min.toFixed(2), p95Ms: +g.p95.toFixed(2), stddevMs: +g.stddev.toFixed(2), rsd: +g.rsd.toFixed(4), triangleTests: lastGrid.tests, hits: lastGrid.hits },
  brute: { queries: BQ, medianMs: +b.median.toFixed(2), minMs: +b.min.toFixed(2), p95Ms: +b.p95.toFixed(2), stddevMs: +b.stddev.toFixed(2), rsd: +b.rsd.toFixed(4), triangleTestsOnSample: lastBrute.tests, perQueryTests: lastBrute.tests / BQ },
  projected: { bruteTriangleTestsFor1M: bruteProjectedTests, ratio: lastGrid.tests / bruteProjectedTests },
  manifold: { frames: frames.length, medianMs: +m.median.toFixed(2), p95Ms: +m.p95.toFixed(2), stddevMs: +m.stddev.toFixed(2), rsd: +m.rsd.toFixed(4), valid: frames.length },
  raw: samples,
};
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 1));
console.log(JSON.stringify({
  coldStartMs: result.coldStartMs,
  grid1M: `${result.grid.medianMs}ms p95=${result.grid.p95Ms}ms rsd=${(result.grid.rsd * 100).toFixed(2)}%`,
  brute2k: `${result.brute.medianMs}ms (${result.brute.perQueryTests} tests/query)`,
  triangleTestRatio: `${(result.projected.ratio * 100).toFixed(4)}%`,
  manifolds: `${result.manifold.frames} in ${result.manifold.medianMs}ms`,
}, null, 1));
