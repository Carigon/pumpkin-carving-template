import type { Point2, ProjectedDesign } from "../types";
import type { Projection } from "./projection";

/** Project placed front-view paths onto the surface, recording each point's angle from the front. */
export function projectDesign(placed: Point2[][], projection: Projection): ProjectedDesign {
  return {
    paths: placed.map((path) => ({
      points: path.map((front) => {
        const hit = projection.project(front);
        if (!hit) return { front, surface: null, angleFromFront: null };
        const facing = Math.max(-1, Math.min(1, hit.normal[2]));
        return {
          front,
          surface: { point: hit.point, normal: hit.normal },
          angleFromFront: (Math.acos(facing) * 180) / Math.PI,
        };
      }),
    })),
  };
}
