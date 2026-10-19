# Build time vs pumpkin size

Research for [#39](https://github.com/Carigon/sphereprojection/issues/39) (part of map #37), run on 2026-10-19 against `main` at `7b9ab06`. It asks how template build time scales with ring radius, height and ring count, and whether the proposed limits (ring radius 1–50 cm, height 2–100 cm) keep the app responsive.

## Answer

- **The proposed caps are fine. Keep 1–50 cm radius and 2–100 cm height.** Pumpkin size alone never pushed a build past about 0.4 s without slits, or past the usual 1–5 s with slits.
- **The pumpkin mesh is fixed in absolute size**, so a bigger pumpkin gets more triangles: about 10k at 15 cm radius, 31–37k at 50 cm. Fitting and the 3D preview still take only 15–60 ms.
- **The paper mesh is mostly relative**: about 1,500 squares over the paper, whatever the size. So a bigger pumpkin costs almost nothing in flattening. The same design on a bigger pumpkin builds *faster*, because the flatter skin needs fewer slits.
- **Ring count barely matters.** The profile fit has a fixed number of terms, so 1 ring and 20 rings cost about the same.
- **What does get slow is shape, not size.** Very flat or very tall-and-thin shapes inside the caps can over-refine the paper mesh: 1.4–4 s with no slits, and 20 s in one flat case. A guard on height compared with width, or a refinement fix, would cover that (see [Edge cases](#edge-cases-shape-not-size)).

## How resolution is set (from the source)

| Stage | Where | Resolution rule | Scales with size? |
|---|---|---|---|
| Profile fit | `src/core/surface/profile.ts` (`MODES = 32`, `NODES = 256`) | Fixed number of cosine terms and constraint nodes, "rather than growing with the rings" | No. Constant for any size or ring count |
| Surface mesh (also the 3D preview mesh) | `src/core/surface/fitSurface.ts` (`MESH_TOLERANCE_CM = 0.025`), `src/core/surface/revolvedMesh.ts` | Each facet stays within 0.25 mm of the smooth shape. A relative floor (`RELATIVE_TOLERANCE = 1/4000` of the size) only kicks in past about 1 m radius. Columns ≈ π/acos(1 − sag/r), so they grow with √r. Meridian rows come from halving 16 start intervals (at most 8 times) where the chord strays | **Yes, absolute.** Triangles grow about linearly with size |
| Ray-cast tree | `src/core/mesh/meshSurface.ts`, `bvh.ts` | Built over the surface mesh | Yes, with the mesh |
| Paper mesh (ARAP, slits, stretch) | `src/core/flatten/flattenDesign.ts` (`MESH_CELLS = 1500`) | Spacing = min(√(paper area / 1500), margin / 2). Then each patch triangle is split into n² pieces, with one n for the whole patch, set by its *longest* facet (`refinePatch` in `patch.ts`) | **Mostly relative.** About 1,500 cells until the paper is about 37 cm across (where margin/2 = 0.95 cm takes over). After that it's absolute and grows with design area |
| Slit search | `src/core/flatten/placeSlits.ts`, `src/core/template/slits.ts` (`CANDIDATES = 8`, `TRIAL_ITERATIONS = 5`, `MAX_SLITS = 24`) | Per slit: 8 candidate cuts, each with a new Cholesky factor and a 5-iteration ARAP. Then one full solve (≤ 25 iterations, `arap.ts`) | Through the paper mesh size only. The skyline Cholesky (RCM ordering, `sparse.ts`) costs about n·bandwidth², which is superlinear in the vertex count |

The surface is fitted on **both** threads. The main thread calls `builder.preview` (`src/main.ts`) for the 3D view, and the worker runs its own `createTemplateBuilder` (`src/worker/templateWorker.ts`). Each caches the fit until the measurements change. So the fit cost below is what the main thread pays on each measurement edit, not just the worker.

## Method

A throwaway script (not committed) imported `src/core` directly under Node 24.21 (built-in type stripping plus a resolve hook for extensionless imports), on the dev Windows machine. It timed each stage with `performance.now()` after a warm-up build. Pumpkins used rings from a slightly flattened, lopsided profile (radius r·sin^0.7, widest at mid-height), all in cm. The design was a jack-o'-lantern face: two triangle eyes, a nose and a jagged mouth. Slits were Auto (the default) unless noted. Times are single runs; the fit times are medians of 5. Expect ±30 % noise, and the browser worker to be in the same range (same V8).

## Results

### Surface fit (main thread on every measurement change, and the worker)

Height = 1.6·r, one ring.

| Radius (cm) | 1 | 5 | 10 | 15 | 20 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|---|---|
| Surface triangles | 600 | 2,976 | 3,968 | 10,080 | 11,592 | 14,112 | 16,128 | 31,392 |
| `fitSurface` (ms) | 5 | 8 | 9 | 13–14 | 15 | 21 | 22 | 29–56 |

At the corners of the proposed range:

| r × h (cm) | 1 × 2 | 1 × 100 | 50 × 2 | 50 × 50 | 50 × 100 |
|---|---|---|---|---|---|
| Triangles | 600 | 840 | 6,048 | 22,752 | 36,576 |
| `fitSurface` (ms) | 5 | 5 | 9 | 23 | 40 |

The steps in the triangle count (for example 16k → 31k between 40 and 50 cm) come from row halving: one more halving doubles the rows. Most of the time goes to the ray-cast tree (about two thirds at 50 cm). The profile fit stays at 3–6 ms at any size. A first `preview()` after a measurement change took 30–80 ms at 50 cm radius. Repeat previews on the cached fit took about 1 ms. A 36k-triangle mesh is light for three.js.

**Ring count**, r = 15 / 50 cm:

| Rings | 1 | 2 | 3 | 5 | 8 | 12 | 20 |
|---|---|---|---|---|---|---|---|
| Triangles, r = 15 | 10,080 | 5,984 | 9,280 | 8,960 | 8,960 | 9,280 | 14,880 |
| `fitSurface` ms, r = 15 | 13 | 15 | 12 | 11 | 12 | 12 | 18 |
| `fitSurface` ms, r = 50 | 29 | 23 | 29 | 29 | 30 | 30 | 48 |

Rings only matter through the shape they make: 20 closely spaced rings make a wavier profile, which needs more rows. Full builds at r = 30 cm with 1, 3, 6 and 12 rings took 192–222 ms each.

### Same design (15 cm wide) on a bigger pumpkin

| Radius (cm) | 9 | 12 | 15 | 20 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|---|
| Auto: slits placed | 4 | 4 | 2 | 0 | 0 | 0 | 0 |
| Auto: build (s) | 1.8 | 1.3 | 1.3 | 0.16 | 0.13 | 0.13 | 0.13 |
| Paper triangles | 5,181 | 5,310 | 8,131 | 5,060 | 4,771 | 4,759 | 4,358 |

With a fixed 8 slits: 2.6 s (r = 9), 5.0 s (r = 15), 2.3 s (r = 30), 1.8 s (r = 50). Time per slit tracks the paper mesh (200–600 ms), not the pumpkin. The 50 cm surface mesh's extra triangles add almost nothing: the patch under the paper is cut out of it once per build (`weldMesh`, `growPatch`).

### Design scaled with the pumpkin (width = r)

| Radius (cm) | 2 | 5 | 10 | 15 | 20 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|---|---|
| Slits | 1 | 3 | 2 | 2 | 0 | 0 | 0 | 0 |
| Build (s) | 0.52 | 0.88 | 0.52 | 1.36 | 0.28 | 0.21 | 0.20 | 0.16 |

At equal relative size, the paper bends the same, but the fixed absolute slit rules (≥ 1 in apart, ≥ 3/4 in deep) let fewer slits help on big pumpkins. So build time doesn't grow with size here either.

### Very large designs

On r = 50, h = 80 with 4 slits forced, as the design grows from 10 to 75 cm wide:

- The paper mesh grows from about 4k to 13k triangles, unevenly, because the split count n is a whole number.
- Time per slit grows from 0.25 to 1.3 s.
- The total for 4 slits grows from 1.1 to 5.7 s.

Left on Auto, designs 50 and 70 cm wide got no slits (the 50 cm skin is flat enough), so they built in 0.16–0.37 s. Past about 37 cm of paper, the mesh is sized by margin / 2 instead of the 1,500-cell budget. That is where design size, not pumpkin size, starts to cost.

## Edge cases: shape, not size

These are inside the proposed caps but have shapes no pumpkin has.

| Case (r × h, design width, cm) | Height / diameter | Paper triangles | Slits | Build |
|---|---|---|---|---|
| 1 × 100, 1 | 50 | 44,297 | 0 | 4.0 s |
| 2 × 100, 2 | 25 | 38,990 | 0 | 1.4 s |
| 3 × 100, 3 | 17 | 16,161 | 0 | 0.74 s |
| 5 × 100, 5 | 10 | 12,058 | 0 | 0.44 s |
| 10 × 100, 10 | 5 | 9,033 | 0 | 0.24 s |
| 50 × 10, 20 (hangs off the silhouette) | 0.1 | 23,834 | 3 | **19–20 s** (3.7 s per slit) |
| 50 × 10, 15 | 0.1 | 10,027 | 3 | 1.4 s |
| 50 × 2, 20 | 0.02 | 14,569 | 1 | 1.8–1.9 s |
| 50 × 20, 20 | 0.2 | 3,737 | 1 | 0.25 s |

The paper mesh overshoots the 1,500-cell budget here by up to 15×. One likely cause, from reading `refinePatch`: on these shapes the surface facets under the paper differ a lot in size. Long facets on the straight sides sit next to short ones at the bends, and one split count n, set by the longest facet, over-refines all the short ones. The skyline Cholesky cost is superlinear in vertices, so each extra triangle costs more. This mechanism wasn't profiled on its own. Ordinary pumpkin shapes (height / diameter about 0.3–1.5) never showed it.

## Recommendation

1. **Confirm the caps: ring radius 1–50 cm, height 2–100 cm.** Size alone keeps the fit under about 60 ms, the preview mesh under about 40k triangles, and the build within what Auto already takes on a normal pumpkin. A tighter radius cap would gain nothing. Larger pumpkins build no slower, and often faster. The 1 cm lower end is also cheap (≤ 0.3 s), though there the default 3/4 in margin is wider than the pumpkin's radius.
2. **Don't cap ring count for build time.** Up to 20 rings changes the fit by at most about 1.5×. Any ring limit should come from the blueprint UI, not from performance.
3. **Optionally guard the aspect ratio rather than the size.** If the blueprint view lets the carver drag the radius and height independently, the slow cases are shapes like 50 × 10 cm or 2 × 100 cm. Two options:
   - Keep height / widest diameter in roughly **0.2–5**, as a warning or a soft limit. Every measured case in that band built in under 0.5 s without slits.
   - Or fix the cause in `refinePatch`: choose n per facet, or cap the paper triangle count. That would make the guard unnecessary.

   Either can be a follow-up issue; neither blocks #37.
