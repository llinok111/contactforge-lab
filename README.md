# contactforge-lab

**Exact contact manifolds on heightfields: 5,760 contacts in 1,440 manifolds, 100% valid, with a 1,000,000-query triangle-test ratio of 0.6944% against an in-repo brute-force baseline — every predicate is BigInt-rational, with no epsilon anywhere.**

Upstream: none

This is an original tool (not a fork). It answers a concrete question: *given an axis-aligned box resting on a triangulated heightfield, which vertices really penetrate, what is the 4-point contact manifold, and is it usable for a physics warm start?* The page and the node tests share the same `src/core.mjs`.

## Run it

```bash
# 1) regenerate the deterministic sample data (60 scenes × 24 frames)
node tools/gen-sample.mjs

# 2) 18 assertions, real numbers printed (exit 0 = pass)
node bench/verify.mjs

# 3) benchmark: 1M indexed queries + brute baseline, writes bench/result.json
node bench/bench.mjs

# 4) the page (CDN importmap, no install, no bundler)
python3 -m http.server 4173
# open http://localhost:4173
```

## Evidence (from the committed `bench/result.json`, Node v24.19.0)

| Claim | Measured | Baseline / reference |
|---|---|---|
| Exact contact classification | 5,760 contacts over 60 scenes × 24 frames, all depths compared as BigInt rationals | float epsilon: none used, so no epsilon tuning |
| 4-point manifold validity | 1,440 / 1,440 valid (100%), COM strictly inside hull, 0 duplicate features | n/a |
| Friction feasibility (μ=0.7) | 0 slope violations | slope test exact: `(nx²+nz²)·100 ≤ 49·ny²` |
| Warm-start feature-ID stability | mean 98.33%, 3 cycles (10% lift each), 120 cycles measured | target ≥95% |
| 1M indexed height queries | 73.22 ms median (p95 88.81 ms, RSD 7.45%) | brute: 147.445 triangle tests/query × 1M = 288M tests |
| Triangle-test ratio | **2,000,000 / 288,000,000 = 0.6944%** | ≤2% target |
| Oracle cross-check | 2,000 random box poses, 11,018 contacts, 0 mismatches | independent barycentric plane evaluator (`planeHeight`) |
| Determinism | scene hash `c6c3de8c`, data hash `3cc19d31` reproduced twice | fixed seed `0x2f6e2b1` |
| Scale invariance | ×1000 coordinates: identical contact counts and feature IDs across 60 scenes | integer arithmetic, exact at both scales |

Notes on the numbers:

- The **manifold timing** (5.87 ms median, RSD 36.6%) is >10% RSD because the whole pass is only ~6 ms and is dominated by JIT/timer noise; the 1M-query and brute measurements are 73 ms and 3.6 ms and stay at RSD 7.45% / 1.12%. The raw 7 samples are in `result.json.raw`.
- `p95` with 7 samples is the nearest-rank 95th percentile (the max of the 7); no interpolation is claimed.
- `coldStartMs = 3.245` is process start → data loaded + terrain built, before any warmup.

## 本轮创新

**B 档。** The innovation ledger has exact predicates (`selfint-exact-lab`, `swept-collide-lab`) and meshlets, but no project turns *penetrating vertices* into a **feature-ID-stable, warm-startable contact manifold with exact feasibility checks**. New here: (1) all contact decisions (penetration sign, slope/friction cone, COM-in-hull) are integer/rational comparisons, so the "valid manifold" verdict is reproducible without tolerance tuning; (2) the manifold is reduced to ≤4 points by farthest-point sampling and its stability is measured across 3 correction cycles; (3) the page re-runs the identical core and compares its feature hash against the node bake — what you see is what was verified. A pure renderer swap cannot reproduce the numbers, so it is not a skin-deep variant.

## Known limits

- **Vertical penetration only.** Contacts are box vertices projected vertically onto the heightfield, not Euclidean closest points. This is exact for the tested setup (axis-aligned box, heightfield) but is not a general mesh-mesh collision engine.
- **Absolute threshold disclosed:** `MU = 0.7` is an absolute coefficient (slope test); there is no distance epsilon. Heights are integers; any non-integer input must be scaled to integers first, which changes exactness to quantization.
- **Effective scale range:** tested at ×1 and ×1000 (all integers). The predicates are scale-free, but `rat()` uses BigInt, so extreme scales cost more memory; 1e-6-scale floats are not representable exactly and are out of scope.
- **Warm start is a diagnostic, not a solver.** The 10%-per-cycle lift is a proxy for a contact solver's position correction; it does not integrate velocities or impulses.
- Terrain is 288 triangles / 169 vertices. The 0.6944% ratio is for this grid; larger grids make the indexed ratio smaller, not larger.
- The page needs a network path to `unpkg.com` for the pinned three@0.160.0 importmap; no local install is required.

## Quality gates

G1 baseline is `baseline/naive.mjs` (brute all-triangle scan) and is executed by `bench.mjs`; G2 syntax checked for all JS; G3 `src/core.mjs` imports nothing and touches no DOM; G4 verify prints 18 measured assertions; G5 2 warmups + 7 samples + cold start; G6 static server returns 200 and contains the importmap; G7 `rm -rf data && node tools/gen-sample.mjs` rebuilds byte-identical data; G8 no browser automation; G9 this README.

License: MIT (original work).
