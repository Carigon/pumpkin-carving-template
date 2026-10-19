import {
  contourLoops,
  countComponents,
  distanceToNodes,
  distanceToPaths,
  fillHoles,
  gridAround,
  sampleGrid,
  signedArea,
  type Grid,
} from "../geometry/distanceField";
import { convexHull, insidePolygon, simplifyLoop } from "../geometry/polygon";
import { segmentDistance } from "../geometry/segmentIndex";
import type { Point2 } from "../types";

/** Field nodes across the longer side of the covered area: sets how finely the edge follows the design. */
const FIELD_CELLS = 150;

/** The paper to cut out around a design, plus distance lookups for placing slits in it. */
export interface CutRegion {
  /**
   * The cut-out edge: the design's outline grown by the margin, as one closed, counterclockwise polygon.
   * Holes are filled in, and gaps between separate parts of the design are bridged (rounding off
   * concave parts narrower than about twice the bridging radius) so the paper stays in one piece.
   */
  outline: Point2[];
  /** Distance from `p` to the edge: negative inside the paper (how deep `p` is), positive outside. */
  edgeDistance(p: Point2): number;
  /** Exact distance from `p` to the nearest design line, up to the margin (farther points get the margin). */
  designDistance(p: Point2): number;
  /** `edgeDistance` is accurate to about this much. */
  resolution: number;
  /** The closing radius used to bridge separate parts of the design (0 when they were already joined). */
  bridging: number;
}

export interface CutRegionOptions {
  /** How far outside the edge `edgeDistance` must still be meaningful. */
  reach?: number;
  /** A bridging radius to try first (e.g. one found for nearly the same design), instead of searching. */
  bridging?: number;
}

/** The cut-out region for closed design `paths` grown by `margin`. */
export function cutRegion(paths: Point2[][], margin: number, { reach = 0, bridging = 0 }: CutRegionOptions = {}): CutRegion {
  // Paths inside other paths (holes, details within a carve area) can't change the outer edge.
  const outer = outermost(paths);
  let r = bridging;
  let attempt = closedRegion(outer, margin, reach, r);
  if (attempt.loops.length > 1) {
    // Bridge with the smallest closing radius that joins the pieces (a little more, so the bridge has width).
    r = Math.max(r, 1.1 * joiningRadius(attempt.grid, attempt.field) + 2 * attempt.grid.h);
    for (let tries = 0; tries < 2 && attempt.loops.length > 1; tries++, r *= 2) attempt = closedRegion(outer, margin, reach, r);
    if (attempt.loops.length > 1) fillPolygon(attempt.grid, attempt.field, roundedHull(paths.flat(), margin));
    r /= 2;
  }
  if (attempt.loops.length !== 1) attempt.loops = contourLoops(attempt.grid, attempt.field);
  return finish(attempt.grid, attempt.field, attempt.loops, paths, margin, r);
}

/**
 * Field (≤ 0 = paper) of the design grown by `margin`, closed with radius `r` (grown by r, then shrunk
 * by r), holes filled; with its boundary loops.
 */
function closedRegion(paths: Point2[][], margin: number, reach: number, r: number) {
  // Room for the growth by r, so shrinking back isn't cut off by the grid's border.
  const grid = gridAround(paths.flat(), margin + Math.max(reach, r) + margin / 4, FIELD_CELLS);
  const toDesign = distanceToPaths(grid, paths, margin + 2 * grid.h);
  const field = toDesign.map((d) => d - margin);
  if (r > 0) {
    const fromInside = distanceToNodes(grid, (k) => field[k] <= 0);
    const fromOutside = distanceToNodes(grid, (k) => fromInside[k] > r || onBorder(grid, k));
    // Shrunk by a node so the exact grown edge wins wherever the two agree.
    for (let k = 0; k < field.length; k++) field[k] = Math.min(field[k], r - fromOutside[k] + grid.h);
  }
  for (let k = 0; k < field.length; k++) if (onBorder(grid, k)) field[k] = Math.max(field[k], grid.h);
  fillHoles(grid, field, -grid.h);
  return { grid, field, loops: contourLoops(grid, field) };
}

function finish(grid: Grid, field: Float64Array, loops: Point2[][], paths: Point2[][], margin: number, bridging: number): CutRegion {
  const outline = simplifyLoop(loops.reduce((a, b) => (signedArea(b) > signedArea(a) ? b : a)), grid.h / 20);
  // The lookups are built on first use: callers that only want the outline don't pay for them.
  let signed: Float64Array | undefined;
  let toDesign: ((p: Point2) => number) | undefined;
  return {
    outline,
    edgeDistance(p) {
      // Depth inside the paper and distance outside it, to the nearest node across the edge.
      if (!signed) {
        const inside = (k: number) => field[k] <= 0;
        const toOutside = distanceToNodes(grid, (k) => !inside(k));
        const toInside = distanceToNodes(grid, inside);
        const half = grid.h / 2;
        signed = field.map((_, k) => (inside(k) ? -Math.max(0, toOutside[k] - half) : Math.max(0, toInside[k] - half)));
      }
      return sampleGrid(grid, signed, p);
    },
    designDistance(p) {
      toDesign ??= segmentDistance(paths, margin);
      return toDesign(p);
    },
    resolution: grid.h,
    bridging,
  };
}

/** The paths not enclosed by another path. */
function outermost(paths: Point2[][]): Point2[][] {
  const boxes = paths.map((path) => {
    const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
  return paths.filter((path, i) => {
    const p = path[0];
    return !paths.some((other, j) => {
      const b = boxes[j];
      return j !== i && other.length >= 3 && p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && insidePolygon(p, other);
    });
  });
}

/** The smallest growth that joins every piece of the region (field ≤ 0) into one, to within a few percent. */
function joiningRadius(grid: Grid, field: Float64Array): number {
  const fromInside = distanceToNodes(grid, (k) => field[k] <= 0);
  let lo = 0, hi = Math.hypot(grid.nx, grid.ny) * grid.h;
  while (hi - lo > Math.max(grid.h, 0.02 * hi)) {
    const mid = (lo + hi) / 2;
    if (countComponents(grid, (k) => fromInside[k] <= mid) <= 1) hi = mid;
    else lo = mid;
  }
  return hi;
}

function onBorder({ nx, ny }: Grid, k: number): boolean {
  const i = k % nx, j = (k - i) / nx;
  return i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
}

/** Make every node inside `polygon` paper. */
function fillPolygon(grid: Grid, field: Float64Array, polygon: Point2[]): void {
  for (let k = 0; k < field.length; k++) {
    const i = k % grid.nx, j = (k - i) / grid.nx;
    if (insidePolygon({ x: grid.x0 + i * grid.h, y: grid.y0 + j * grid.h }, polygon)) field[k] = Math.min(field[k], -grid.h);
  }
}

/** Fallback: the convex outline grown by the margin, rounded at the corners. */
function roundedHull(points: Point2[], margin: number): Point2[] {
  const grown: Point2[] = [];
  for (const p of convexHull(points)) {
    for (let k = 0; k < 48; k++) {
      const a = (2 * Math.PI * k) / 48;
      grown.push({ x: p.x + margin * Math.cos(a), y: p.y + margin * Math.sin(a) });
    }
  }
  return convexHull(grown);
}
