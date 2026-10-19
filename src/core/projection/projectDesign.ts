import { DESIGN_STEPS, densify } from "../geometry/densify";
import type { Point2, ProjectedDesign, ProjectedPoint } from "../types";
import type { Projection } from "./projection";

/**
 * Project placed front-view paths onto the surface, recording each point's angle from the front. Each path also
 * gets a densified line, split into at least DESIGN_STEPS pieces across the design, for drawing on the skin.
 */
export function projectDesign(placed: Point2[][], projection: Projection): ProjectedDesign {
  const all = placed.flat();
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const lines = densify(placed, extent / DESIGN_STEPS);
  const project = (front: Point2): ProjectedPoint => {
    const hit = projection.project(front);
    if (!hit) return { front, surface: null, angleFromFront: null };
    const facing = Math.max(-1, Math.min(1, hit.normal[2]));
    return {
      front,
      surface: { point: hit.point, normal: hit.normal },
      angleFromFront: (Math.acos(facing) * 180) / Math.PI,
    };
  };
  return { paths: placed.map((path, i) => ({ points: path.map(project), line: lines[i].map(project) })) };
}
