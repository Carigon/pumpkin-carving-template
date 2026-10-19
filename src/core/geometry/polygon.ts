import type { Point2 } from "../types";

const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Andrew's monotone chain; counterclockwise, without collinear points. */
export function convexHull(points: Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const half = (pts: Point2[]) => {
    const out: Point2[] = [];
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Distance from `p` to a counterclockwise convex polygon: 0 inside, else distance to its boundary. */
export function distanceToConvex(p: Point2, polygon: Point2[]): number {
  if (polygon.length === 0) return Infinity;
  let inside = polygon.length >= 3;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (cross(a, b, p) < 0) inside = false;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return inside ? 0 : best;
}
