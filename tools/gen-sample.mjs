// Deterministic scene generator: 60 box-on-heightfield poses, 24 frames each.
// Run: node tools/gen-sample.mjs   (writes data/scenes.json + data/reference.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import * as core from '../src/core.mjs';

const COLS = 12, ROWS = 12, CELL = 1000;
const heights = [];
for (let j = 0; j <= ROWS; j++) {
  for (let i = 0; i <= COLS; i++) {
    // gentle deterministic relief: <= 120 units over a 12k span (~0.6 deg)
    heights.push(120 * Math.round(Math.sin(i * 0.7) * 2 + Math.cos(j * 0.5) * 2) + 7 * i + 5 * j);
  }
}
const terrain = core.buildTerrain({ cols: COLS, rows: ROWS, cell: CELL, heights });
const HALF = [1500, 1500, 1500];

let seed = 0x2f6e2b1;
function rnd() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }

const scenes = [];
for (let s = 0; s < 60; s++) {
  const cx = Math.round((3 + rnd() * 6) * CELL);
  const cz = Math.round((3 + rnd() * 6) * CELL);
  const frames = [];
  for (let f = 0; f < 24; f++) {
    // all four bottom corners must penetrate: bottom below the lowest surface
    const cy = -HALF[1] + f * 1; // provisional, corrected below
    const probe = core.boxVerts([cx, 0, cz], HALF).filter(v => v[1] === -HALF[1]);
    let minH = Infinity;
    for (const v of probe) {
      const sh = core.surfaceAt(terrain, v[0], v[2]);
      minH = Math.min(minH, core.ratToNumber(sh.y));
    }
    const drop = 120 + f * 45 + Math.round(rnd() * 60);
    const bottom = Math.round(minH - drop);
    frames.push({ center: [cx, bottom + HALF[1], cz], half: HALF });
  }
  scenes.push({ id: s, frames });
}

const baked = [];
let totalContacts = 0, totalManifolds = 0, validManifolds = 0, slopeViolations = 0;
let featureSet = new Set();
for (const sc of scenes) {
  const rows = [];
  for (let f = 0; f < sc.frames.length; f++) {
    const fr = sc.frames[f];
    const { contacts, tests } = core.contactsFor(terrain, fr.center, fr.half);
    const man = core.buildManifold(contacts, [fr.center[0], fr.center[2]]);
    totalContacts += contacts.length;
    slopeViolations += contacts.filter(c => !c.slopeOk).length;
    if (contacts.length) { totalManifolds++; if (man.valid) validManifolds++; }
    for (const c of contacts) featureSet.add(`${sc.id}:${f}:${c.featureId}`);
    const ids = man.points.map(p => p.featureId).sort().join('|');
    rows.push({
      count: contacts.length, tests,
      valid: man.valid, reason: man.reason,
      depthMax: man.points.length ? Math.max(...man.points.map(p => p.depthNum)) : 0,
      ids, hash: core.hashString(ids),
    });
  }
  baked.push(rows);
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const sceneDoc = { terrain: { cols: COLS, rows: ROWS, cell: CELL, heights }, half: HALF, scenes };
const sceneBytes = JSON.stringify(sceneDoc);
writeFileSync(new URL('../data/scenes.json', import.meta.url), sceneBytes);

const reference = {
  generator: 'tools/gen-sample.mjs', seed: '0x2f6e2b1',
  scenes: scenes.length, frames: scenes.length * 24,
  totalContacts, totalManifolds, validManifolds,
  slopeViolations,
  distinctFeatures: featureSet.size,
  sceneHash: core.sceneHash(terrain, scenes),
  dataHash: core.hashString(sceneBytes),
  perFrame: baked,
};
writeFileSync(new URL('../data/reference.json', import.meta.url), JSON.stringify(reference, null, 1));
console.log(JSON.stringify({
  scenes: reference.scenes, frames: reference.frames, totalContacts,
  manifolds: totalManifolds, validManifolds, slopeViolations,
  sceneHash: reference.sceneHash, dataHash: reference.dataHash,
}, null, 1));
