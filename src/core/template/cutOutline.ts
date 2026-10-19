import { convexHull } from "../geometry/polygon";
import type { Point2 } from "../types";

const ROUND_STEPS = 48;

/**
 * The cut-out edge: the design's outline grown by `margin`, measured on paper.
 * v1 uses the design's convex outline, rounded at the corners. Convex keeps the edge simple to cut
 * and gives slits a clean edge to start from. Counterclockwise, implicitly closed.
 */
export function cutOutline(paths: Point2[][], margin: number): Point2[] {
  const grown: Point2[] = [];
  for (const p of convexHull(paths.flat())) {
    for (let k = 0; k < ROUND_STEPS; k++) {
      const a = (2 * Math.PI * k) / ROUND_STEPS;
      grown.push({ x: p.x + margin * Math.cos(a), y: p.y + margin * Math.sin(a) });
    }
  }
  return convexHull(grown);
}
