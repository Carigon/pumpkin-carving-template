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
    .filter((path) => Math.abs(area(path)) > tolerance * tolerance);
  return paths.length > 0 ? { paths, bbox: bboxOf(paths) } : null;
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
