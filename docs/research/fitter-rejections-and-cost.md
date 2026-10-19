# Profile fitter: when it rejects rings, and what a fit costs

Research for [#38](https://github.com/Carigon/sphereprojection/issues/38) (part of map [#37](https://github.com/Carigon/sphereprojection/issues/37), Blueprint view). Done on 2026-10-19 against commit `7b9ab06`. Sources are the code itself, plus throwaway probes run under Vitest 5 / Node 24.21 on the dev machine (Windows 11). The probes were not committed. One of them was an instrumented copy of `profile.ts` that logs which stage rejected a fit.

## Short answer

- **Rejections come from two layers.** `checkMeasurements` catches five input errors, each with its own message. `fitProfile` can fail at three stages. All three end in the same generic warning, and that warning names the **widest** ring, not the ring that caused the problem.
- **Only the input checks have a closed form.** A `fitProfile` failure can only be found by running the fit. The failure region isn't a simple shape in (position, circumference). On one edge of it the result flips between pass and fail on floating-point round-off (see [Finding 3](#3-the-pole-check-flips-on-round-off)).
- **Cost:** `fitSurface` takes about 9–12 ms (median) for 1–10 rings. That fills most of a 16.7 ms frame at 60 Hz, so it is **not comfortable** to run on every pointer move on the main thread. `fitProfile` alone takes about 3–4 ms (median), and drawing the outline from it adds 0.25 ms. That part is affordable. Mesh and BVH can wait until release.
- **A failed fit returns nothing drawable**: `{ ok: false, warnings }` with no profile or surface. For a dashed outline, the view has to keep the last good profile, or the core has to start returning the rejected candidate profile.

## 1. Rejection conditions and their warnings

All of them are `MeasurementWarning`s with `kind: "impossible-measurement"` (`src/core/types.ts:73`). `fitSurface` returns them as `{ ok: false, warnings }`, and `buildTemplate` passes them through unchanged with `surface: null` (`src/core/buildTemplate.ts:99`).

### a. Input checks: `checkMeasurements` (`src/core/surface/fitSurface.ts:65`)

These all run together, so one call can return several warnings. Each ring gets at most one, the first that applies, in the order below.

| # | Condition | `field` / `ring` | Message |
|---|---|---|---|
| 1 | height not finite or ≤ 0 | `height` | "Height must be a positive number." |
| 2 | `rings.length === 0` | `ring`, no index | "Measure at least one ring: the widest circumference." |
| 3 | position not finite, or not strictly inside (0, 1) | `ring`, i | "The ring must be between the bottom and the top of the pumpkin, more than 0 and less than {H} {units} above the table." (the range part only appears when the height is valid) |
| 4 | circumference not finite or ≤ 0 | `ring`, i | "Circumference must be a positive number." |
| 5 | an earlier ring sits within 1e-9 of the same position | `ring`, i (the later one) | "Another ring is already at this height." |

If any of these fire, `fitProfile` never runs. They take about 0 ms.

### b. Shape fit: `fitProfile` (`src/core/surface/profile.ts:154`)

Every failure here comes back as `{ ok: false, ring: w }`, where `w` is the index of the widest ring. `fitSurface` turns that into **one** warning (`fitSurface.ts:36–41`):

> field `ring`, ring `w`, "No smooth pumpkin shape passes through these rings. Check their heights and circumferences."

The code reaches that warning in three ways:

| Stage | Where | What fails |
|---|---|---|
| **QP infeasible** | `profile.ts:202–203` | If the radii rise strictly to the widest ring and fall strictly after it (`unimodal`), the "one widest point" quadratic program (`rising`) runs first. If it is infeasible, or if the rings aren't unimodal, the "between the axis and the widest radius" program (`capped`) runs. A failure is reported only when both fail. In the probes, infeasibility always ended the same way: all 32 Fourier modes active, with no step left (`step === Infinity`, `profile.ts:298`). The fixed 32-mode basis (`MODES`, `profile.ts:135`) can't make the profile steep enough. |
| **Pole check** | `profile.ts:210–212` | `q0 = dρ/dφ` at the stem or `qPi` at the base is not strictly positive. The meant meaning is a profile "pointed at" a pole. |
| **Interior radius** | same line | ρ ≤ 0 at any of the 255 interior nodes. This is possible only on the `capped` path, whose lower bound is ρ ≥ 0. |

Measured triggers (H = 9 in unless noted):

- **A ring close in height to the widest, with a very different radius.** With the widest at 0.45 / r 4.8, a second ring 0.0005–0.005 above it fails at every radius from 0.5 to 4.79. A ring 0.01 above fails unless r ≥ 4.5. Cause: QP infeasible.
- **A very narrow ring near a pole, or a ring that pinches the top or bottom.** For example, rings (0.15, 3.5), (0.45, 4.8) plus (0.66, 1.5) or (0.02, 0.25) fail. Cause: pole check. The smoothest shape needs q < 0 at the pole, the QP bound holds q at exactly 0, and the strict `> 0` test then rejects it.
- **The widest ring alone, very near a pole**: positions 0.001 and 0.999 fail.
- **A crossing ring that becomes the new widest right next to another ring**: (0.14, 6) beside (0.15, 3.5). Cause: `capped` infeasible.
- **Many rings**: 30 or more rings sampled from a smooth sine profile fail, while 20 and 25 pass. This is far beyond what a carver would measure.

What **does not** fail: rings sampled from smooth single-bulge shapes, 2–10 rings, 200 shapes each (squat to pointy, widest at 0.3–0.66), with 0 rejections. Two equal widest rings, or a dip between two near-widest rings, fit fine on the `capped` path. In a uniformly random search (1–10 rings, positions 0.02–0.98, radii 1–7) half of the cases fail, and the failure rate rises with the ring count (10 % for 1 ring, 85 % for 10). Most of those random cases are nothing like a pumpkin.

## 2. Can a failure be predicted cheaply while dragging?

**Only for the input checks.** Conditions 1–5 are closed-form and O(n), so the view can check them itself, or just call `fitSurface`, which returns at once. While dragging, the realistic ones are 3 (dragged off the top or bottom) and 5 (dropped exactly on another ring).

**The `fitProfile` failures have no closed form.** They depend on a 32-variable QP with 514 bound constraints. Sweeping one ring of a 3-ring pumpkin over a 25 × 24 grid of position × radius gives a rejection map with a broad band beside the widest ring, a band beside the other fixed ring, and isolated failing cells inside regions that otherwise pass (excerpt: rows are radius, columns are position 0.02 → 0.98 in steps of 0.04, `X` = rejected):

```
 3.00 ...........XX...X........
 2.75 ..........XXX...X........
 2.50 ..........XXX....X.......
 2.25 ..........XXXXX..XX......
 1.50 ..XX.....X.X....X..X.....
```

So the only way to know is to run the fit. A cheap heuristic could flag the most common case (a ring within about 0.01–0.02 of the widest ring with a much smaller radius), but it would miss the pole cases and give false alarms.

### 3. The pole check flips on round-off

When the pole bound is active, `q0` comes out as ±1e-15, and its sign decides the result. Rings (0.15, 3.5), (0.45, 4.8), (0.66, r):

| r | 2.90 | 2.95 | 3.00 | 3.05 | 3.10 |
|---|---|---|---|---|---|
| result | fail (q0 = −4.7e-15) | **pass** (q0 = +1.3e-15) | fail (q0 = −1.8e-15) | pass (q0 = 0.04) | pass (q0 = 0.20) |

Moving the position by 0.01 at r = 3.0 flips it back to a pass. Two effects follow:

- **Live dragging will flicker.** Along the edge of the pole region, the outline will switch between solid and dashed from one pixel to the next. Accepted fits at that edge have a pole slope of about 1e-15, which is just as "pointed" as the rejected ones.
- **The convexity claim fails at that edge.** The header of `profile.ts` says a ring read off the fit and added again "changes nothing". Adding 49 such rings, one at a time, to (0.15, 3.5), (0.45, 4.8), (0.8, 3.6) caused 1 rejection.

A tolerance in the pole test (for example `q0 > −ε·R`) would make the edge stable. If pointed poles should really be rejected, a margin like `q0 ≥ ε·R` built into the QP bound would do it. That's a fix for the fitter, not the Blueprint view. It may deserve its own ticket.

## 4. Cost per fit

Medians of at least 20 timed runs after warm-up, with p95 in brackets, in ms. The rings are sampled from a smooth 30 in, 9 in-tall pumpkin. The mesh tolerance is 0.25 mm, giving 6,000–8,400 triangles.

| Rings | `fitSurface` (all of it) | `fitProfile` | `revolvedMesh` | `meshSurface` (BVH) | 257-point outline (`profileAt`) |
|---|---|---|---|---|---|
| 1 | 11.6 (14.8) | 3.3 (4.4) | 2.1 (3.4) | 5.2 (7.8) | 0.27 |
| 3 | 9.4 (10.7) | 3.2 (4.1) | 1.6 (2.9) | 4.0 (4.2) | 0.25 |
| 6 | 9.4 (11.3) | 3.8 (4.1) | 1.4 (2.9) | 3.7 (3.9) | 0.25 |
| 10 | 9.8 (10.4) | 3.6 (4.3) | 1.6 (2.4) | 4.1 (4.3) | 0.25 |

- The cost barely depends on the ring count. The QP has a fixed 32 unknowns and 514 bounds. Ring equalities add only a few rows.
- **A failing `fitProfile` costs more than a passing one**: median 7.7 ms, p95 13 ms, max 21 ms in the random search, against 3.5 / 6.6 / 14 ms for passing fits. That's because a failure often tries both programs before giving up. In the 3-ring drag sweep the median was 3.8 ms and the max 18 ms.
- `createTemplateBuilder` caches one fit, keyed by `JSON.stringify(measurements)` (`buildTemplate.ts:74–79`). Every drag step is a new key, so `builder.preview()` would refit and re-mesh on every move. `main.ts:194` already runs `preview()` on the main thread for each edit, and the projection adds to that cost.

**For 60 Hz:** a full `fitSurface` (about 10 ms, up to 15 ms) leaves too little of the frame for drawing and input. A fit that fails can go past 16 ms with the meshing. Running `fitProfile` plus the outline (about 3.5 ms typical, p95 about 7 ms, worst about 20 ms on failures) is affordable if pointer moves are coalesced to one fit per animation frame. Node timings are only an approximation of browser speed. Slower laptops or phones may take 2–3× as long, which still leaves `fitProfile` under a frame in the typical case.

The core doesn't export `fitProfile` today (`src/core/index.ts` exports only `buildTemplate`, `createTemplateBuilder`, `nextRing` and so on). The Blueprint view needs a small public entry point for it, such as "fit outline only", which runs `checkMeasurements` and `fitProfile` and returns the sampled profile or the warnings.

## 5. What a failed fit returns

Nothing drawable. `SurfaceFit` on failure is `{ ok: false; warnings: MeasurementWarning[] }` (`fitSurface.ts:16`), and `ProfileFit` is `{ ok: false; ring: number }` (`profile.ts:127`). `TemplateResult.surface` is `null`.

How much the code has computed before failing depends on the stage:

- **Input checks and QP infeasible**: no candidate shape exists.
- **Pole or interior-radius check**: the candidate `profile` (its coefficients) is fully built at `profile.ts:204–207` and then thrown away. Returning it, for example `{ ok: false, ring, rejected?: Profile }`, would let the view draw the shape it nearly accepted as the dashed outline. That case is exactly where the round-off flicker happens.

For the Blueprint view, the simplest choice that always works is to **draw the dashed outline from the last good profile** and show the warning. Optionally, connect the ring handles with straight segments so the dragged ring still looks attached. Note that the warning's `ring` index is the widest ring, not the dragged one, so the view should highlight the ring being dragged rather than trust that index.

## Sources

- `src/core/surface/fitSurface.ts`: `fitSurface`, `checkMeasurements`, `ringWarning`
- `src/core/surface/profile.ts`: `fitProfile`, `unimodal`, `minimumNorm` (Goldfarb–Idnani), constants `NODES = 256`, `MODES = 32`
- `src/core/surface/revolvedMesh.ts`, `src/core/mesh/meshSurface.ts`: meshing and BVH costs
- `src/core/buildTemplate.ts`: builder cache and the failure pass-through
- `src/core/rings.ts`: `nextRing` falls back to blending neighbouring rings when the fit fails
- `src/core/types.ts`: `MeasurementWarning`, `SurfaceParameters`
- `src/main.ts:194`: `preview()` runs on the main thread for each edit
