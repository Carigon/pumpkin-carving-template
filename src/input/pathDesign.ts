import type { BBox, Design, Point2 } from "../core";
import { flattenPathData, roughExtent } from "./flattenPath";

/** The loader's tolerance, as a fraction of the design's larger dimension (≈0.13 mm on a 10 in design). */
export const RELATIVE_TOLERANCE = 5e-4;

/**
 * The `Design` that SVG path data (in SVG space, y down) fills: flattened at the loader's tolerance and y flipped
 * to point up, as `readSvgDesign` does. A subpath enclosing no area drops out quietly; null when none is left.
 * This is the one route a hand-trace's shapes take to the `Design` (and the download writes the same path data).
 */
export function designFromPathData(d: string): Design | null {
  if (!d.trim()) return null;
  const extent = roughExtent(d, "");
  const tolerance = RELATIVE_TOLERANCE * Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 1e-9);
  const paths = flattenPathData(d, "", tolerance)
    .map((path) => path.map(({ x, y }) => ({ x, y: -y })))
    .filter((path) => enclosesArea(path, tolerance * tolerance));
  return paths.length > 0 ? { paths, bbox: bboxOf(paths) } : null;
}

/**
 * Whether a closed polyline encloses more than `least` area filled even-odd. Its signed area settles most at once;
 * one whose loops cancel out (a figure-eight with equal loops) is measured by its even-odd area.
 */
function enclosesArea(path: Point2[], least: number): boolean {
  return Math.abs(area(path)) > least || evenOddArea(path) > least;
}

/**
 * The area a closed polyline fills even-odd, crossings and all: summed over vertical slabs between every x where an
 * edge starts, ends or crosses another. Inside a slab no edges cross, so they stack in one order and every other gap
 * between them is filled, a trapezoid measured at the slab's middle.
 */
function evenOddArea(path: Point2[]): number {
  const edges: [Point2, Point2][] = path
    .map((p, i): [Point2, Point2] => [p, path[(i + 1) % path.length]])
    .filter(([p, q]) => p.x !== q.x)
    .map(([p, q]) => (p.x < q.x ? [p, q] : [q, p]));
  const xs = edges.flatMap(([p, q]) => [p.x, q.x]);
  edges.forEach(([a, b], i) => {
    for (const [c, d] of edges.slice(i + 1)) {
      const x = crossingX(a, b, c, d);
      if (x !== null) xs.push(x);
    }
  });
  const cuts = [...new Set(xs)].sort((u, v) => u - v);
  const yAt = ([p, q]: [Point2, Point2], x: number) => p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
  let sum = 0;
  for (let k = 1; k < cuts.length; k++) {
    const [x0, x1] = [cuts[k - 1], cuts[k]];
    const mid = (x0 + x1) / 2;
    const ys = edges
      .filter(([p, q]) => p.x <= x0 && q.x >= x1)
      .map((e) => yAt(e, mid))
      .sort((u, v) => u - v);
    for (let j = 1; j < ys.length; j += 2) sum += (ys[j] - ys[j - 1]) * (x1 - x0);
  }
  return sum;
}

/** Where segments `a`–`b` and `c`–`d` cross strictly inside both, by x; null when they don't. */
function crossingX(a: Point2, b: Point2, c: Point2, d: Point2): number | null {
  const [rx, ry, sx, sy] = [b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y];
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? a.x + t * rx : null;
}

/** The box around every point of `paths`. */
export function bboxOf(paths: Point2[][]): BBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const path of paths) {
    for (const { x, y } of path) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box;
}

/** Signed area of a closed polyline (shoelace). */
function area(path: Point2[]): number {
  let sum = 0;
  path.forEach((p, i) => {
    const q = path[(i + 1) % path.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return sum / 2;
}
