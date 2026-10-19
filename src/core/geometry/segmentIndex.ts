import type { Point2 } from "../types";
import { distanceToSegment } from "./polygon";

/**
 * Exact distance from a point to the nearest segment of closed paths, for distances up to `range`
 * (farther points get `range`). Segments are bucketed on a grid of `range`-sized cells.
 */
export function segmentDistance(paths: Point2[][], range: number): (p: Point2) => number {
  const buckets = new Map<string, [Point2, Point2][]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const path of paths) {
    for (let s = 0; s < path.length; s++) {
      const a = path[s], b = path[(s + 1) % path.length];
      const i0 = Math.floor(Math.min(a.x, b.x) / range), i1 = Math.floor(Math.max(a.x, b.x) / range);
      const j0 = Math.floor(Math.min(a.y, b.y) / range), j1 = Math.floor(Math.max(a.y, b.y) / range);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const list = buckets.get(key(i, j));
          if (list) list.push([a, b]);
          else buckets.set(key(i, j), [[a, b]]);
        }
      }
    }
  }
  return (p) => {
    const ci = Math.floor(p.x / range), cj = Math.floor(p.y / range);
    let best = range;
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (const [a, b] of buckets.get(key(i, j)) ?? []) best = Math.min(best, distanceToSegment(p, a, b));
      }
    }
    return best;
  };
}
