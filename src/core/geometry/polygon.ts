import type { BBox, Point2 } from "../types";
import { distance } from "./vector";

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

/** Distance from `p` to the segment a–b. */
export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** The point of a closed polygon's boundary nearest to `p`, and its distance. */
export function nearestOnPolygon(p: Point2, polygon: Point2[]): { point: Point2; distance: number } {
  let best = { point: p, distance: Infinity };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = distance(p, q);
    if (d < best.distance) best = { point: q, distance: d };
  }
  return best;
}

/** The smallest axis-aligned box holding every point. */
export function boundingBox(points: Point2[]): BBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x, y } of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

/** Is `p` inside the closed polygon (even-odd rule)? */
export function insidePolygon(p: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

/**
 * The piece of an open polyline around its vertex `at` (which must be inside the polygon) that stays
 * inside the closed polygon, cut exactly where it first leaves on either side. Null if `at` is outside.
 */
export function pieceInside(line: Point2[], at: number, polygon: Point2[]): Point2[] | null {
  if (!insidePolygon(line[at], polygon)) return null;
  const walk = (step: 1 | -1): Point2[] => {
    const out: Point2[] = [];
    for (let i = at + step; i >= 0 && i < line.length; i += step) {
      const prev = line[i - step], p = line[i];
      if (insidePolygon(p, polygon)) {
        out.push(p);
        continue;
      }
      const hit = firstCrossing(prev, p, polygon);
      if (hit) out.push(hit);
      break;
    }
    return out;
  };
  return [...walk(-1).reverse(), line[at], ...walk(1)];
}

/** Where segment p–q first crosses the polygon's edge, measured from p; null if it doesn't. */
function firstCrossing(p: Point2, q: Point2, polygon: Point2[]): Point2 | null {
  let best = Infinity;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-15) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / denom;
    const s = ((a.x - p.x) * dy - (a.y - p.y) * dx) / denom;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? { x: p.x + best * dx, y: p.y + best * dy } : null;
}

/** Douglas–Peucker on a closed loop: drop points while the loop moves by less than `tolerance`. */
export function simplifyLoop(loop: Point2[], tolerance: number): Point2[] {
  if (loop.length < 4) return loop;
  // Split the loop at its first point and the point farthest from it, and simplify both halves.
  const far = loop.reduce((best, p, i) => (distance(p, loop[0]) > distance(loop[best], loop[0]) ? i : best), 0);
  const keep = new Uint8Array(loop.length);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, loop.length]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = loop[a], pb = loop[b % loop.length];
    let worst = -1, worstDistance = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(loop[i], pa, pb);
      if (d > worstDistance) [worst, worstDistance] = [i, d];
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return loop.filter((_, i) => keep[i]);
}
