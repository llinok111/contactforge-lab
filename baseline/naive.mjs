// Brute-force baseline: scan every triangle for every query (no spatial index).
// Independent of src/core.mjs: re-implements point-in-triangle in the xz plane.
export function bruteSurface(tris, cell, cols, rows, x, z) {
  if (x < 0 || z < 0 || x > cols * cell || z > rows * cell) return { inside: false, tested: 0 };
  let tested = 0;
  for (const t of tris) {
    tested++;
    const d1 = (t.b[0] - t.a[0]) * (z - t.a[2]) - (t.b[2] - t.a[2]) * (x - t.a[0]);
    const d2 = (t.c[0] - t.b[0]) * (z - t.b[2]) - (t.c[2] - t.b[2]) * (x - t.b[0]);
    const d3 = (t.a[0] - t.c[0]) * (z - t.c[2]) - (t.a[2] - t.c[2]) * (x - t.c[0]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return { inside: true, triId: t.id, tested };
  }
  return { inside: false, tested };
}
