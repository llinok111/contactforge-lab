// contactforge core — exact contact manifolds on integer heightfields.
// Pure ES module: no three.js, no DOM, no I/O, no environment access.
// All geometric predicates use BigInt rationals; there is no epsilon anywhere.

export const MU = 0.7; // friction coefficient, only used for slope feasibility

/* ---------------- exact rational helpers ---------------- */

export function rat(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new Error('rat: zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  return { n, d };
}
export function ratCmp(a, b) {
  const l = a.n * b.d, r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}
export function ratSub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
export function ratAdd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
export function ratToNumber(a) { return Number(a.n) / Number(a.d); }
export function ratKey(a) { return `${a.n}/${a.d}`; }

/* ---------------- terrain ---------------- */

// heights: (cols+1)*(rows+1) integers, row-major. cell: integer size.
export function buildTerrain({ cols, rows, cell, heights }) {
  if (heights.length !== (cols + 1) * (rows + 1)) throw new Error('height count mismatch');
  const tris = [];
  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h00 = heights[j * (cols + 1) + i];
      const h10 = heights[j * (cols + 1) + i + 1];
      const h01 = heights[(j + 1) * (cols + 1) + i];
      const h11 = heights[(j + 1) * (cols + 1) + i + 1];
      const x0 = i * cell, z0 = j * cell;
      const A = [x0, h00, z0], B = [x0 + cell, h10, z0];
      const C = [x0, h01, z0 + cell], D = [x0 + cell, h11, z0 + cell];
      // triangle 0: A,B,C ; triangle 1: B,D,C
      const t0 = { id: tris.length, a: A, b: B, c: C, i, j, kind: 0 };
      const t1 = { id: tris.length + 1, a: B, b: D, c: C, i, j, kind: 1 };
      t0.normal = triNormal(t0); t1.normal = triNormal(t1);
      tris.push(t0, t1);
      cells.push([t0.id, t1.id]);
    }
  }
  return { cols, rows, cell, heights, tris, cells, bbox: [0, 0, 0, cols * cell, 0, rows * cell] };
}

function triNormal(t) {
  const u = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]];
  const v = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // canonical: make the y component positive (upward facing in this y-up world)
  if (n[1] < 0) return [-n[0], -n[1], -n[2]];
  return n;
}

// point-in-triangle in the xz plane, exact integer orientation
function insideXZ(t, x, z) {
  const s = (ax, az, bx, bz, px, pz) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const d1 = s(t.a[0], t.a[2], t.b[0], t.b[2], x, z);
  const d2 = s(t.b[0], t.b[2], t.c[0], t.c[2], x, z);
  const d3 = s(t.c[0], t.c[2], t.a[0], t.a[2], x, z);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// exact surface height (rational, denominator = cell) under integer x,z.
// Returns { y, triId, normal, inside } where inside reports whether xz is inside
// the terrain footprint (boundary inclusive, clamped to the last cell row/col).
export function surfaceAt(terrain, x, z) {
  const { cols, rows, cell, heights, tris } = terrain;
  const maxX = cols * cell, maxZ = rows * cell;
  if (x < 0 || z < 0 || x > maxX || z > maxZ) return { inside: false };
  let i = Math.floor(x / cell), j = Math.floor(z / cell);
  if (i >= cols) i = cols - 1;
  if (j >= rows) j = rows - 1;
  const u = x - i * cell, v = z - j * cell;
  const h00 = heights[j * (cols + 1) + i];
  const h10 = heights[j * (cols + 1) + i + 1];
  const h01 = heights[(j + 1) * (cols + 1) + i];
  const h11 = heights[(j + 1) * (cols + 1) + i + 1];
  let t, y;
  if (u + v <= cell) {
    t = tris[(j * cols + i) * 2];
    y = rat(h00 * cell + (h10 - h00) * u + (h01 - h00) * v, cell);
  } else {
    t = tris[(j * cols + i) * 2 + 1];
    const a = cell - u, b = cell - v;
    y = rat(h11 * cell + (h01 - h11) * a + (h10 - h11) * b, cell);
  }
  return { inside: true, y, triId: t.id, normal: t.normal, tri: t };
}

/* ---------------- box + contacts ---------------- */

export function boxVerts(center, half) {
  const [cx, cy, cz] = center, [hx, hy, hz] = half;
  const out = [];
  for (let k = 0; k < 8; k++) {
    out.push([cx + (k & 1 ? hx : -hx), cy + (k & 2 ? hy : -hy), cz + (k & 4 ? hz : -hz)]);
  }
  return out;
}

// candidate triangles from the containing cell of (x,z) on a grid index
function gridCandidates(terrain, x, z) {
  const { cols, rows, cell } = terrain;
  if (x < 0 || z < 0 || x > cols * cell || z > rows * cell) return [];
  let i = Math.min(Math.floor(x / cell), cols - 1);
  let j = Math.min(Math.floor(z / cell), rows - 1);
  return { tris: terrain.cells[j * cols + i], tested: 2 };
}

// independent oracle: barycentric plane evaluation on an arbitrary triangle
export function planeHeight(t, x, z) {
  const ax = BigInt(t.a[0]), az = BigInt(t.a[2]);
  const bx = BigInt(t.b[0]), bz = BigInt(t.b[2]);
  const cx = BigInt(t.c[0]), cz = BigInt(t.c[2]);
  const X = BigInt(x), Z = BigInt(z);
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (det === 0n) return null;
  const l1 = rat((bz - cz) * (X - cx) + (cx - bx) * (Z - cz), det);
  const l2 = rat((cz - az) * (X - cx) + (ax - cx) * (Z - cz), det);
  const one = rat(1);
  const l3r = ratSub(ratSub(one, l1), l2);
  const y = ratAdd(ratAdd(rat(BigInt(t.a[1]) * l1.n, l1.d), rat(BigInt(t.b[1]) * l2.n, l2.d)),
                   rat(BigInt(t.c[1]) * l3r.n, l3r.d));
  return y;
}

export function triTestBrute(terrain, x, z) {
  let tested = 0;
  for (const t of terrain.tris) {
    tested++;
    if (insideXZ(t, x, z)) return { triId: t.id, tested };
  }
  return { triId: -1, tested };
}

// exact contact set for one axis-aligned box pose. Vertical penetration is
// measured along y between a box vertex and the heightfield surface below it.
export function contactsFor(terrain, center, half, opts = {}) {
  const verts = boxVerts(center, half);
  const out = [];
  let tests = 0;
  const brute = opts.mode === 'brute';
  for (let k = 0; k < verts.length; k++) {
    const [x, y, z] = verts[k];
    const s = surfaceAt(terrain, x, z);
    if (!s.inside) continue;
    if (brute) {
      const b = triTestBrute(terrain, x, z);
      tests += b.tested;
      const cand = terrain.tris[b.triId];
      const oy = cand ? planeHeight(cand, x, z) : null;
      if (!oy || ratCmp(oy, s.y) !== 0) throw new Error('oracle mismatch');
    } else {
      const c = gridCandidates(terrain, x, z);
      tests += c.tested;
      if (!c.tris.includes(s.triId)) throw new Error('grid miss');
    }
    const depth = ratSub(s.y, rat(y));
    if (ratCmp(depth, rat(0)) > 0) {
      const n = s.normal;
      const slopeOk = (n[0] * n[0] + n[2] * n[2]) * 100 <= 49 * n[1] * n[1];
      out.push({
        vid: k, triId: s.triId,
        x, z, depth: ratKey(depth), depthNum: ratToNumber(depth),
        normal: n, slopeOk,
        featureId: `v${k}@t${s.triId}`,
      });
    }
  }
  return { contacts: out, tests };
}

/* ---------------- manifold ---------------- */

function cross2(o, a, b) {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length <= 2) return pts;
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Choose up to 4 contacts: deepest first, then farthest-point sampling.
export function buildManifold(contacts, comXZ) {
  if (!contacts.length) return { points: [], valid: false, reason: 'no-contacts' };
  const ranked = contacts.slice().sort((a, b) => b.depthNum - a.depthNum || a.vid - b.vid);
  const pts = [ranked[0]];
  while (pts.length < Math.min(4, ranked.length)) {
    let best = null, bestD = -1;
    for (const c of ranked) {
      if (pts.includes(c)) continue;
      let d = Infinity;
      for (const p of pts) d = Math.min(d, (c.x - p.x) ** 2 + (c.z - p.z) ** 2);
      if (d > bestD) { bestD = d; best = c; }
    }
    pts.push(best);
  }
  const distinct = new Set(pts.map(p => p.featureId)).size === pts.length;
  const hull = convexHull(pts.map(p => ({ x: p.x, z: p.z })));
  // strict interior of the hull for the centre of mass
  let comInside = hull.length >= 3;
  if (comInside) {
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      if (cross2(a, b, { x: comXZ[0], z: comXZ[1] }) <= 0) { comInside = false; break; }
    }
  }
  const slopeOk = pts.every(p => p.slopeOk);
  const depthOk = pts.every(p => p.depthNum > 0);
  const valid = distinct && depthOk && slopeOk && comInside && pts.length <= 4;
  let reason = 'ok';
  if (!distinct) reason = 'duplicate-feature';
  else if (!depthOk) reason = 'non-penetrating';
  else if (!slopeOk) reason = 'friction-cone';
  else if (!comInside) reason = 'com-outside-hull';
  return { points: pts, valid, reason, hullSize: hull.length, comInside };
}

/* ---------------- warm start ---------------- */

// Three correction cycles: lift the box by 90% of the deepest penetration and
// re-detect. Feature IDs of the retained contacts are compared across cycles.
export function warmStart(terrain, scene, cycles = 3) {
  let center = scene.center.slice();
  let prev = null;
  const out = [];
  for (let c = 0; c < cycles; c++) {
    const { contacts } = contactsFor(terrain, center, scene.half);
    const ids = new Set(contacts.map(p => p.featureId));
    const kept = prev ? [...prev].filter(id => ids.has(id)).length : ids.size;
    const stability = prev && prev.size ? kept / prev.size : 1;
    out.push({ cycle: c, count: contacts.length, stability });
    if (!contacts.length) break;
    const deepest = Math.max(...contacts.map(p => p.depthNum));
    center = [center[0], center[1] + Math.ceil(deepest * 0.1), center[2]];
    prev = ids;
  }
  return out;
}

/* ---------------- deterministic hash (FNV-1a 32-bit, hex) ---------------- */

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function sceneHash(terrain, scenes) {
  return hashString(JSON.stringify({ h: terrain.heights, c: terrain.cell, s: scenes }));
}
