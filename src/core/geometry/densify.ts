import type { Point2 } from "../types";
import { distance } from "./vector";

/** Design segments are split into at least this many pieces across the design. */
export const DESIGN_STEPS = 100;

/** Split each closed path's segments so no piece is longer than `step`; paths stay closed implicitly. */
export function densify(paths: Point2[][], step: number): Point2[][] {
  return paths.map((path) =>
    path.flatMap((a, i) => {
      const b = path[(i + 1) % path.length];
      const pieces = step > 0 ? Math.max(1, Math.ceil(distance(a, b) / step)) : 1;
      return Array.from({ length: pieces }, (_, k) => ({
        x: a.x + ((b.x - a.x) * k) / pieces,
        y: a.y + ((b.y - a.y) * k) / pieces,
      }));
    }),
  );
}
