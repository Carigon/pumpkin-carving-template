import { edgesOf } from "./curves";
import type { Shape } from "./model";
import { shapesAsDrawn } from "./symmetry";

/** A position in some 2D space. */
interface XY {
  x: number;
  y: number;
}

/** Significant digits kept in path data: far finer than the loader's tolerance. */
const DIGITS = 6;

/**
 * Path data (`M`, `L`, `C`, `Z`) for `shapes` with each point mapped through `map`, a mirrored shape's reflection
 * generated about the symmetry axis at x = `axis` (ADR 0004): an edge with a handle at either end (a smooth point's
 * automatic ones included) is a cubic, one with none a straight line. Closed shapes end with `Z`.
 */
export function pathData(shapes: readonly Shape[], map: (p: XY) => XY, axis: number): string {
  return shapes.flatMap((s) => shapesAsDrawn(s, axis).map((o) => shapePath(o.shape, map))).join("");
}

/** Path data (`M`, `L`, `Z`) for closed polylines, such as a region the core found, mapped through `map`. */
export function loopsPathData(loops: readonly (readonly XY[])[], map: (p: XY) => XY): string {
  const xy = (p: XY) => {
    const q = map(p);
    return `${num(q.x)} ${num(q.y)}`;
  };
  return loops.map((loop) => (loop.length === 0 ? "" : `M${loop.map(xy).join("L")}Z`)).join("");
}

function shapePath(shape: Shape, map: (p: XY) => XY): string {
  const pts = shape.points;
  if (pts.length === 0) return "";
  const xy = (p: XY) => {
    const q = map(p);
    return `${num(q.x)} ${num(q.y)}`;
  };
  let d = `M${xy(pts[0])}`;
  for (const e of edgesOf(shape)) d += e.curved ? `C${xy(e.c1)} ${xy(e.c2)} ${xy(e.b)}` : `L${xy(e.b)}`;
  return shape.closed ? `${d}Z` : d;
}

function num(v: number): string {
  return String(Number(v.toPrecision(DIGITS)));
}
