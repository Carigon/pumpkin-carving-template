import type { Point, Shape } from "./model";

/** A position in some 2D space. */
interface XY {
  x: number;
  y: number;
}

/** Significant digits kept in path data: far finer than the loader's tolerance. */
const DIGITS = 6;

/**
 * Path data (`M`, `L`, `C`, `Z`) for `shapes` with each point mapped through `map`: a side with a handle is a
 * cubic, a side with none a straight line. Closed shapes end with `Z`.
 */
export function pathData(shapes: readonly Shape[], map: (p: XY) => XY): string {
  return shapes.map((s) => shapePath(s, map)).join("");
}

function shapePath(shape: Shape, map: (p: XY) => XY): string {
  const pts = shape.points;
  if (pts.length === 0) return "";
  const xy = (p: XY) => {
    const q = map(p);
    return `${num(q.x)} ${num(q.y)}`;
  };
  let d = `M${xy(pts[0])}`;
  const edges = shape.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < edges; i++) {
    const [u, v] = [pts[i], pts[(i + 1) % pts.length]];
    d += u.out || v.in ? `C${xy(tip(u, u.out))} ${xy(tip(v, v.in))} ${xy(v)}` : `L${xy(v)}`;
  }
  return shape.closed ? `${d}Z` : d;
}

/** A handle's tip, or the point itself on a side with no handle. */
function tip(p: Point, handle: XY | undefined): XY {
  return handle ? { x: p.x + handle.x, y: p.y + handle.y } : p;
}

function num(v: number): string {
  return String(Number(v.toPrecision(DIGITS)));
}
