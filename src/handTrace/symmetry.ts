/**
 * Live symmetry (spec #27, "Symmetry"; ADR 0004): a mirrored shape as drawn, its reflection generated from
 * its `mirror` flag, and the rules that keep a mirrored shape's points in step with the vertical symmetry axis. A
 * twin is reflected as a separate shape; a symmetric shape is its half joined to its reversed reflection at both
 * ends. Every function takes the axis as its x in design space and gives new shapes; nothing is changed in place.
 */
import { handlesOf, type Side, type XY } from "./curves";
import type { Offset, Point, Shape } from "./model";

/** How close (design units) a point is to the axis to be on it: points are put on it exactly, by snap or clamp. */
const ON_AXIS = 1e-9;

/**
 * Where one side of a point as drawn comes from: the side of the shape's point, its handle `mirrored` in the axis
 * or not; null on a symmetric shape's straight join across the axis, which has no handle.
 */
export type SideSource = { side: Side; mirrored: boolean } | null;

/** One point of a shape as drawn: the shape's point `index`, as placed or `reflected` in the axis. */
export interface PointAsDrawn {
  index: number;
  reflected: boolean;
  in: SideSource;
  out: SideSource;
}

/**
 * One shape as drawn: `shape` is a plain shape (no mirror) through its points' positions with their handles, so
 * `edgesOf` and `handlesOf` work on it as on any shape, automatic handles seeing their neighbours across the axis.
 * `reflected` for a twin's reflection.
 */
export interface ShapeAsDrawn {
  shape: Shape;
  pointsAsDrawn: PointAsDrawn[];
  reflected: boolean;
}

/** Whether `p` lies on the axis. */
export const onAxis = (p: XY, axis: number): boolean => Math.abs(p.x - axis) <= ON_AXIS;

/** `p` reflected in the axis. */
const reflectXY = (p: XY, axis: number): XY => ({ x: 2 * axis - p.x, y: p.y });

/** A handle's offset reflected in the axis. */
export const mirrorOffset = (o: Offset): Offset => ({ x: -o.x, y: o.y });

/** The shapes `shape` is drawn as: itself; with its reflection beside it (a twin); or its whole (symmetric). */
export function shapesAsDrawn(shape: Shape, axis: number): ShapeAsDrawn[] {
  const plain = { ...shape, mirror: "none" as const };
  const same = (index: number): PointAsDrawn => ({
    index,
    reflected: false,
    in: { side: "in", mirrored: false },
    out: { side: "out", mirrored: false },
  });
  const itself: ShapeAsDrawn = { shape: plain, pointsAsDrawn: shape.points.map((_, i) => same(i)), reflected: false };
  if (shape.mirror === "none") return [itself];
  if (shape.mirror === "twin") {
    const points = shape.points.map((p) => reflectPoint(p, axis));
    const pointsAsDrawn = shape.points.map((_, i): PointAsDrawn => ({
      index: i,
      reflected: true,
      in: { side: "in", mirrored: true },
      out: { side: "out", mirrored: true },
    }));
    return [itself, { shape: { ...plain, points }, pointsAsDrawn, reflected: true }];
  }
  return [symmetricWhole(shape, axis)];
}

/**
 * A symmetric shape drawn whole: its half, then the half reflected and reversed. An end on the axis is one point,
 * its handle on the half's side reflected for the other; an end off it is joined to its reflection by a straight
 * edge, so it acts as a corner there with the handle it has as an open shape's end.
 */
function symmetricWhole(shape: Shape, axis: number): ShapeAsDrawn {
  const pts = shape.points;
  const n = pts.length;
  const asOpen = handlesOf({ ...shape, closed: false });
  const join = (i: number): { start: boolean; end: boolean } => ({ start: i === 0, end: i === n - 1 });
  const merged = (i: number) => (i === 0 || i === n - 1) && onAxis(pts[i], axis);
  const points: Point[] = [];
  const pointsAsDrawn: PointAsDrawn[] = [];
  pts.forEach((p, i) => {
    const { start, end } = join(i);
    if (!start && !end) {
      points.push(p);
      pointsAsDrawn.push({ index: i, reflected: false, in: { side: "in", mirrored: false }, out: { side: "out", mirrored: false } });
      return;
    }
    if (merged(i)) {
      // The half holds the handle facing into it; the reflection supplies the other.
      const own: Side = start && !end ? "out" : "in";
      const h = p[own];
      const [hin, hout] = own === "in" ? [h, h && mirrorOffset(h)] : [h && mirrorOffset(h), h];
      points.push({ x: p.x, y: p.y, kind: p.kind, ...(hin && { in: hin }), ...(hout && { out: hout }) });
      const [mine, theirs] = [{ side: own, mirrored: false }, { side: own, mirrored: true }];
      pointsAsDrawn.push({ index: i, reflected: false, in: own === "in" ? mine : theirs, out: own === "out" ? mine : theirs });
      return;
    }
    const h = asOpen[i];
    const handles = { ...(!start && h.in && { in: h.in }), ...(!end && h.out && { out: h.out }) };
    points.push({ x: p.x, y: p.y, kind: "corner", ...handles });
    pointsAsDrawn.push({
      index: i,
      reflected: false,
      in: start ? null : { side: "in", mirrored: false },
      out: end ? null : { side: "out", mirrored: false },
    });
  });
  for (let i = n - 1; i >= 0; i--) {
    if (merged(i)) continue;
    const { start, end } = join(i);
    // Reversed, so the point's in side faces forwards and its out side back.
    const p = pts[i];
    const acting = start || end ? asOpen[i] : p;
    const [hin, hout] = [!end ? acting.out : undefined, !start ? acting.in : undefined];
    const kind = start || end ? "corner" : p.kind;
    const q = reflectXY(p, axis);
    points.push({ ...q, kind, ...(hin && { in: mirrorOffset(hin) }), ...(hout && { out: mirrorOffset(hout) }) });
    pointsAsDrawn.push({
      index: i,
      reflected: true,
      in: end ? null : { side: "out", mirrored: true },
      out: start ? null : { side: "in", mirrored: true },
    });
  }
  return { shape: { ...shape, mirror: "none", closed: true, points }, pointsAsDrawn, reflected: false };
}

/**
 * `shape` closed. A twin whose closed edge runs along the axis (two points in a row on it, the closing edge
 * included and looked at first) is half of one symmetric shape, wherever it was started: its points start just after
 * that edge, so the half runs axis to axis and the edge drops out when the reflection joins on.
 */
export function closed(shape: Shape, axis: number): Shape {
  const pts = shape.points;
  const n = pts.length;
  const along = (i: number) => onAxis(pts[i], axis) && onAxis(pts[(i + 1) % n], axis);
  const edge = shape.mirror !== "twin" ? -1 : along(n - 1) ? n - 1 : pts.findIndex((_, i) => along(i));
  if (edge < 0) return { ...shape, closed: true };
  return { ...shape, closed: true, mirror: "symmetric", points: [...pts.slice(edge + 1), ...pts.slice(0, edge + 1)] };
}

/**
 * Which side of the axis a mirrored shape keeps to: that of its first point off the axis (leaving out point `skip`,
 * the one being moved), 1 to the right, -1 to the left, 0 while all are on it (either side then).
 */
export function sideOf(shape: Shape, axis: number, skip = -1): -1 | 0 | 1 {
  const p = shape.points.find((q, i) => i !== skip && !onAxis(q, axis));
  return p ? (p.x > axis ? 1 : -1) : 0;
}

/** `x` kept to `side` of the axis, the axis itself allowed. */
export function keptToSide(x: number, side: -1 | 0 | 1, axis: number): number {
  return side > 0 ? Math.max(x, axis) : side < 0 ? Math.min(x, axis) : x;
}

/**
 * A curve edit (`edit`, from `curves.ts`) made to a mirrored shape, near its points `touched`. A twin edits as any
 * shape. A symmetric shape's half edits as an open shape (its ends have no neighbour there), its touched ends' handles
 * first stored as they act on the whole shape, so the edit starts from the shape as drawn; after it, a smooth end
 * on the axis keeps its handle at right angles to the axis, so the join stays smooth.
 */
export function editMirrored(shape: Shape, axis: number, touched: number[], edit: (plain: Shape) => Shape): Shape {
  if (shape.mirror !== "symmetric") return edit(shape);
  const n = shape.points.length;
  let plain: Shape = { ...shape, closed: false };
  for (const i of new Set(touched.filter((i) => i === 0 || i === n - 1))) {
    const p = shape.points[i];
    const own = ownSide(shape, i);
    const acting = own && actingHandle(shape, axis, i, own);
    if (own && p.kind === "smooth" && !p[own] && acting) plain = withPoint(plain, i, { ...p, [own]: acting });
  }
  const done = edit(plain);
  return squaredEnds({ ...done, closed: true }, axis);
}

/**
 * The side of a symmetric shape's end point `i` that faces into its half (the other faces the axis); null for a
 * point between its ends.
 */
function ownSide(shape: Shape, i: number): Side | null {
  const n = shape.points.length;
  return i === 0 && n > 1 ? "out" : i === n - 1 && n > 1 ? "in" : null;
}

/** Point `i`'s handle on `side` as it acts on the shape as drawn (automatic ones worked out), if it has one. */
export function actingHandle(shape: Shape, axis: number, i: number, side: Side): Offset | undefined {
  for (const o of shapesAsDrawn(shape, axis)) {
    const k = o.pointsAsDrawn.findIndex((nd) => nd.index === i && !nd.reflected);
    const pointAsDrawn = o.pointsAsDrawn[k];
    if (!pointAsDrawn) continue;
    const own = (s: SideSource) => s?.side === side && !s.mirrored;
    const at = own(pointAsDrawn.in) ? "in" : own(pointAsDrawn.out) ? "out" : null;
    return at ? handlesOf(o.shape)[k][at] : undefined;
  }
  return undefined;
}

/** A symmetric shape whose smooth ends on the axis hold their handles at right angles to it (level). */
function squaredEnds(shape: Shape, axis: number): Shape {
  let out = shape;
  shape.points.forEach((p, i) => {
    const own = ownSide(shape, i);
    const h = own && p[own];
    if (!own || !h || p.kind !== "smooth" || !onAxis(p, axis) || h.y === 0) return;
    const { [own]: _old, ...rest } = p;
    out = withPoint(out, i, Math.abs(h.x) > 1e-12 ? { ...rest, [own]: { x: h.x, y: 0 } } : rest);
  });
  return out;
}

function withPoint(shape: Shape, i: number, point: Point): Shape {
  return { ...shape, points: shape.points.map((p, k) => (k === i ? point : p)) };
}

/** `p` reflected in the axis, its handles mirrored. */
function reflectPoint(p: Point, axis: number): Point {
  const handles = { ...(p.in && { in: mirrorOffset(p.in) }), ...(p.out && { out: mirrorOffset(p.out) }) };
  return { ...reflectXY(p, axis), kind: p.kind, ...handles };
}
