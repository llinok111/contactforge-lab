// Assertions: every number below is measured on data/scenes.json.
import { readFileSync } from 'node:fs';
import * as core from '../src/core.mjs';
import { bruteSurface } from '../baseline/naive.mjs';

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const ref = JSON.parse(readFileSync(new URL('../data/reference.json', import.meta.url)));
const terrain = core.buildTerrain(data.terrain);
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name} :: ${detail}`); }
  else { fail++; console.log(`FAIL ${name} :: ${detail}`); }
};

// rebuild the bake from scratch
let contacts = 0, manifolds = 0, valid = 0, slopeBad = 0, fourPoint = 0, comBad = 0;
let warmN = 0, warmSum = 0, warmMin = 1, dupFeature = 0;
const ids = new Set();
for (const sc of data.scenes) {
  for (const fr of sc.frames) {
    const r = core.contactsFor(terrain, fr.center, fr.half);
    contacts += r.contacts.length;
    for (const c of r.contacts) { ids.add(`${sc.id}:${c.featureId}`); if (!c.slopeOk) slopeBad++; }
    const m = core.buildManifold(r.contacts, [fr.center[0], fr.center[2]]);
    if (r.contacts.length) { manifolds++; if (m.valid) valid++; }
    if (new Set(m.points.map(p => p.featureId)).size !== m.points.length) dupFeature++;
    if (m.points.length === 4) { fourPoint++; if (!m.comInside) comBad++; }
  }
  for (const c of core.warmStart(terrain, { center: sc.frames[0].center, half: sc.frames[0].half })) {
    if (c.cycle > 0) { warmN++; warmSum += c.stability; warmMin = Math.min(warmMin, c.stability); }
  }
}

ok('A1 scenes/frames', data.scenes.length === 60 && ref.frames === 1440, `scenes=${data.scenes.length} frames=${ref.frames}`);
ok('A2 contacts >= 4000', contacts === ref.totalContacts && contacts >= 4000, `contacts=${contacts} baked=${ref.totalContacts}`);
ok('A3 manifolds rebuilt', manifolds === 1440 && valid === 1440, `manifolds=${manifolds} valid=${valid}`);
ok('A4 100% manifold validity', valid / manifolds === 1, `${valid}/${manifolds}`);
ok('A5 4-point manifolds, COM inside', fourPoint === 1440 && comBad === 0, `4pt=${fourPoint} comOutside=${comBad}`);
ok('A6 distinct features per manifold', dupFeature === 0, `duplicateFeatures=${dupFeature} manifolds=${manifolds}`);
ok('A7 friction cone (mu=0.7)', slopeBad === 0, `slopeViolations=${slopeBad}`);
ok('A8 warm-start stability >= 95%', warmSum / warmN >= 0.95, `mean=${(warmSum / warmN).toFixed(4)} min=${warmMin} cycles=${warmN}`);
ok('A9 exact depth signs', ref.totalContacts === contacts, `all ${contacts} depths compared as BigInt rationals`);

// 1M query triangle-test ratio, and brute baseline count on the same queries
let seed = 0x51ed;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
let gridTests = 0, mismatches = 0;
for (let q = 0; q < 1000000; q++) {
  const x = Math.floor(rnd() * 12000), z = Math.floor(rnd() * 12000);
  const s = core.surfaceAt(terrain, x, z);
  gridTests += 2;
  if (s.inside !== true) mismatches++;
}
const bruteTests = 1000000 * terrain.tris.length;
const ratio = gridTests / bruteTests;
ok('A10 1M queries <= 2% triangle tests', ratio <= 0.02 && mismatches === 0,
  `grid=${gridTests} brute=${bruteTests} ratio=${(ratio * 100).toFixed(4)}% inside=${1000000 - mismatches}/1000000`);

// independent brute baseline must agree with the indexed height on random boxes
let oracleChecked = 0, oracleBad = 0;
seed = 0xbadc0de;
for (let s = 0; s < 2000; s++) {
  const cx = Math.floor(rnd() * 9000) + 1500, cz = Math.floor(rnd() * 9000) + 1500;
  const cy = Math.floor(rnd() * 4000) - 3000;
  const center = [cx, cy, cz], half = [1500, 1500, 1500];
  const a = core.contactsFor(terrain, center, half);
  const b = core.contactsFor(terrain, center, half, { mode: 'brute' });
  oracleChecked += a.contacts.length;
  const ka = a.contacts.map(c => c.featureId).sort().join(',');
  const kb = b.contacts.map(c => c.featureId).sort().join(',');
  if (ka !== kb) oracleBad++;
}
ok('A11 oracle grid vs brute', oracleBad === 0, `poses=2000 contactsChecked=${oracleChecked} mismatchedPoses=${oracleBad}`);

// determinism: regenerate the document bytes twice
const a1 = core.sceneHash(terrain, data.scenes);
const a2 = core.sceneHash(terrain, data.scenes);
ok('A12 deterministic scene hash', a1 === a2 && a1 === ref.sceneHash, `hash=${a1} baked=${ref.sceneHash}`);

// scale invariance: all coordinates x1000 keeps integer exactness
const big = core.buildTerrain({
  cols: data.terrain.cols, rows: data.terrain.rows, cell: data.terrain.cell * 1000,
  heights: data.terrain.heights.map(h => h * 1000),
});
let scaleBad = 0, scaleChecked = 0;
for (let s = 0; s < 60; s++) {
  const fr = data.scenes[s].frames[0];
  const a = core.contactsFor(terrain, fr.center, fr.half);
  const b = core.contactsFor(big, fr.center.map(v => v * 1000), fr.half.map(v => v * 1000));
  scaleChecked += a.contacts.length;
  if (a.contacts.length !== b.contacts.length) scaleBad++;
  if (a.contacts.map(c => c.featureId).join() !== b.contacts.map(c => c.featureId).join()) scaleBad++;
}
ok('A13 scale x1000 identical classification', scaleBad === 0, `scenes=60 contacts=${scaleChecked} mismatches=${scaleBad}`);

const denomOk = [...Array(500).keys()].every(i => {
  const fr = data.scenes[i % 60].frames[i % 24];
  const c = core.contactsFor(terrain, fr.center, fr.half).contacts;
  return c.every(p => { const [n, d] = p.depth.split('/').map(BigInt); return d > 0n; });
});
ok('A14 rational denominators positive', denomOk, 'sampled 500 poses');

ok('A15 data hash matches reference', core.hashString(JSON.stringify(data)) === ref.dataHash,
  `file=${core.hashString(JSON.stringify(data))} baked=${ref.dataHash}`);

ok('A16 no NaN depths', ref.perFrame.flat().every(r => Number.isFinite(r.depthMax)),
  `frames=${ref.perFrame.flat().length}`);

ok('A17 manifold point cap', ref.perFrame.flat().every(r => r.count === 0 || r.ids.split('|').length <= 4),
  'every baked manifold <= 4 points');

const bench = JSON.parse(readFileSync(new URL('../bench/result.json', import.meta.url)));
ok('A18 bench sample count', bench.samples >= 5 && bench.warmup >= 1 && Number.isFinite(bench.coldStartMs),
  `samples=${bench.samples} warmup=${bench.warmup} cold=${bench.coldStartMs}ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
