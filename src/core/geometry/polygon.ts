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

/** Distance from `p` to the segment a–b. */
export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Is `p` inside (or on) a counterclockwise convex polygon? */
export function insideConvex(p: Point2, polygon: Point2[]): boolean {
  return polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], p) >= 0);
}

/**
 * How far a ray from `origin` (inside the polygon) along the unit vector `dir` travels before it
 * leaves a counterclockwise convex polygon.
 */
export function rayExit(origin: Point2, dir: Point2, polygon: Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denom;
    const s = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

/** The parts of an open polyline inside a counterclockwise convex polygon, cut exactly at its edge. */
export function clipToConvex(line: Point2[], polygon: Point2[]): Point2[][] {
  const pieces: Point2[][] = [];
  let current: Point2[] = [];
  const flush = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const clipped = clipSegment(line[i], line[i + 1], polygon);
    if (!clipped) {
      flush();
      continue;
    }
    const [p, q] = clipped;
    const last = current[current.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) {
      flush();
      current.push(p);
    }
    current.push(q);
  }
  flush();
  return pieces;
}

/** Cyrus–Beck: the part of segment p–q inside a counterclockwise convex polygon, or null. */
function clipSegment(p: Point2, q: Point2, polygon: Point2[]): [Point2, Point2] | null {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    // Inside means cross(a, b, x) >= 0: f(t) = f0 + t * df.
    const f0 = cross(a, b, p);
    const df = (b.x - a.x) * dy - (b.y - a.y) * dx;
    if (Math.abs(df) < 1e-15) {
      if (f0 < 0) return null;
      continue;
    }
    const t = -f0 / df;
    if (df > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  const at = (t: number) => ({ x: p.x + t * dx, y: p.y + t * dy });
  return [at(t0), at(t1)];
}
