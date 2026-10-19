import { centroid } from "../geometry/vector";
import type { CutRegion } from "../template/cutOutline";
import { slitPlanner, type SlitPlanOptions } from "../template/slits";
import type { Point2 } from "../types";
import { arapFlatten } from "./arap";
import { cutSlits, type SlitMesh, type TriangleMesh } from "./mesh";
import { strainSummary, type StrainSummary } from "./stretch";

export interface SlitPlacementOptions extends SlitPlanOptions {
  /** How many slits to place, or "auto" to add them until they stop paying (see `placeSlits`). */
  count: number | "auto";
}

/** Auto adds slits until the paper's 95th-percentile stretch is down to this... */
const AUTO_TARGET = 0.03;
/** ...or the next slit lowers the RMS stretch by less than this fraction... */
const AUTO_MIN_GAIN = 0.03;
/** ...or it has placed this many. */
export const MAX_SLITS = 24;
/** ARAP iterations when scoring a candidate slit, warm-started from the layout without it. */
const TRIAL_ITERATIONS = 5;

export interface SlitPlacement extends SlitMesh {
  /** Per slit, a chain of edge-adjacent vertices of the uncut mesh from the mesh boundary to its tip. */
  chains: number[][];
  /** The flattened layout of the cut mesh. */
  flat: Point2[];
  /**
   * Auto stopped with the paper still stretching more than `AUTO_TARGET`, because it placed `MAX_SLITS` slits or no
   * more fit (not because the next slit would barely help).
   */
  overTarget: boolean;
}

/**
 * Cut slits into `uncut` where they relieve the most stretch, and flatten it. `layout` places its vertices close to
 * the paper (a fold-free start for ARAP), and `region` is the cut-out region in that layout.
 *
 * Slits go in one at a time. For each, every candidate the planner offers is cut and scored by the paper's RMS
 * stretch after a short ARAP solve warm-started from the current layout; the best is kept and the mesh is solved
 * in full before the next. Stretch is measured on the paper only (triangles inside the cut-out edge).
 *
 * Yields the number of slits placed so far after each one, so a caller can report progress or stop between slits.
 */
export function* placeSlits(
  uncut: TriangleMesh,
  layout: Point2[],
  region: CutRegion,
  options: SlitPlacementOptions,
): Generator<number, SlitPlacement> {
  const auto = options.count === "auto";
  const wanted = auto ? MAX_SLITS : Math.min(MAX_SLITS, Math.max(0, Math.round(options.count as number)));
  const onPaper = uncut.triangles.map((tri) => region.edgeDistance(centroid(tri.map((v) => layout[v]))) < 0);
  // Cutting keeps triangle indices, so `onPaper` holds for every cut mesh too.
  const strain = (mesh: TriangleMesh, flat: Point2[]) => strainSummary(mesh, flat, onPaper);

  const chains: number[][] = [];
  let cut: SlitMesh = { mesh: uncut, otherSide: [] };
  let flat = arapFlatten(uncut, { initial: layout });
  let current: StrainSummary = strain(uncut, flat);
  const planner = wanted > 0 && options.depth > 0 ? slitPlanner(uncut, layout, region, options) : null;

  /** Whether placing stopped because no more slits may or can go in, rather than because they stopped paying. */
  let limited = true;
  for (let round = 0; planner && chains.length < wanted; round++) {
    if (auto && current.p95 <= AUTO_TARGET) {
      limited = false;
      break;
    }
    let best: { chain: number[]; cut: SlitMesh; flat: Point2[]; rms: number } | null = null;
    for (const chain of planner.candidates(round)) {
      const trial = cutSlits(uncut, [...chains, chain]);
      // Start from the current layout: earlier cuts keep their vertex indices, and the new cut's copies start
      // where the vertices they were split from are.
      const initial = trial.mesh.vertices.map((_, v) => flat[v]);
      trial.otherSide[chains.length].forEach((copy, i) => (initial[copy] = flat[chain[i]]));
      const quick = arapFlatten(trial.mesh, { initial, maxIterations: TRIAL_ITERATIONS });
      const { rms } = strain(trial.mesh, quick);
      if (!best || rms < best.rms) best = { chain, cut: trial, flat: quick, rms };
    }
    if (!best) break;
    const solved = arapFlatten(best.cut.mesh, { initial: best.flat });
    const next = strain(best.cut.mesh, solved);
    if (auto && current.rms - next.rms < AUTO_MIN_GAIN * current.rms) {
      limited = false;
      break;
    }
    chains.push(best.chain);
    planner.take(best.chain);
    cut = best.cut;
    flat = solved;
    current = next;
    yield chains.length;
  }
  const overTarget = auto && limited && current.p95 > AUTO_TARGET;
  return { ...cut, chains, flat, overTarget };
}
