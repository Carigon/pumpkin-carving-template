/**
 * Curve maths for the hand-trace's shapes (spec #27, "Curves"): the handles each point acts with, its edges as
 * cubics, and the edits that bend them: switching a point's kind, dragging a handle, inserting and deleting points.
 * Every function takes a shape and gives a new one; nothing is changed in place.
 */
import type { Offset, Point, Shape } from "./model";

/** A position or direction in design space. */
export interface XY {
  x: number;
  y: number;
}

/** A point's two sides: `in` faces the previous point, `out` the next. */
export type Side = "in" | "out";

/** A point's handles as they act: its stored ones and, on a smooth point, the automatic ones worked out. */
export interface Handles {
  in?: Offset;
  out?: Offset;
}

/** One edge as a cubic, from point `after` to the next: `curved` when either end has a handle on it. */
export interface Edge {
  after: number;
  a: XY;
  c1: XY;
  c2: XY;
  b: XY;
  curved: boolean;
}

/** Samples taken along each old edge when a delete refits one cubic to two. */
const FIT_SAMPLES = 24;

/** The point next to point `i` on `side`, or null at an open shape's end. */
export function neighbour(shape: Shape, i: number, side: Side): number | null {
  const n = shape.points.length;
  const j = side === "out" ? i + 1 : i - 1;
  if (j >= 0 && j < n) return j;
  return shape.closed && n > 2 ? (j + n) % n : null;
}

/**
 * Each point's handles as they act. A smooth point's missing handles are automatic: along the direction from the
 * previous point to the next (or along its one stored handle), a third of the way to each neighbour.
 */
export function handlesOf(shape: Shape): Handles[] {
  const pts = shape.points;
  return pts.map((p, i) => {
    const stored: Handles = { ...(p.in && { in: p.in }), ...(p.out && { out: p.out }) };
    if (p.kind !== "smooth" || (p.in && p.out)) return stored;
    const [prev, next] = [neighbour(shape, i, "in"), neighbour(shape, i, "out")].map((j) => (j === null ? null : pts[j]));
    const dir = p.out
      ? unit(p.out)
      : p.in
        ? unit(scale(p.in, -1))
        : prev && next
          ? unit(sub(next, prev))
          : next
            ? unit(sub(next, p))
            : prev && unit(sub(p, prev));
    if (!dir) return stored;
    return {
      ...((p.in ?? prev) && { in: p.in ?? scale(dir, -distance(p, prev!) / 3) }),
      ...((p.out ?? next) && { out: p.out ?? scale(dir, distance(p, next!) / 3) }),
    };
  });
}

/** The shape's edges as cubics, in order; a closed shape's last edge runs back to its first point. */
export function edgesOf(shape: Shape): Edge[] {
  const pts = shape.points;
  const handles = handlesOf(shape);
  const count = shape.closed ? pts.length : pts.length - 1;
  const out: Edge[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % pts.length;
    const [h1, h2] = [handles[i].out, handles[j].in];
    const [a, b] = [xy(pts[i]), xy(pts[j])];
    out.push({ after: i, a, c1: h1 ? add(a, h1) : a, c2: h2 ? add(b, h2) : b, b, curved: !!(h1 || h2) });
  }
  return out;
}

/** The point at `t` along edge `e`. */
export function edgeAt(e: Edge, t: number): XY {
  const s = 1 - t;
  const [w0, w1, w2, w3] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return { x: w0 * e.a.x + w1 * e.c1.x + w2 * e.c2.x + w3 * e.b.x, y: w0 * e.a.y + w1 * e.c1.y + w2 * e.c2.y + w3 * e.b.y };
}

/** Edge `e` as a polyline of `pieces` straight pieces (just its two ends when it's straight). */
export function edgePolyline(e: Edge, pieces: number): XY[] {
  if (!e.curved) return [e.a, e.b];
  return Array.from({ length: pieces + 1 }, (_, k) => edgeAt(e, k / pieces));
}

/**
 * Smooth ⇄ Corner on point `i`. A corner keeps the handles it acted with, now independent. A smooth point made from a
 * corner with both handles points them along their average direction, keeping their lengths; with fewer, the rest
 * are automatic.
 */
export function toggleKind(shape: Shape, i: number): Shape {
  const p = shape.points[i];
  if (p.kind === "smooth") return withPoint(shape, i, { ...p, ...handlesOf(shape)[i], kind: "corner" });
  if (!p.in || !p.out) return withPoint(shape, i, { ...p, kind: "smooth" });
  const dir = unit(sub(unit(p.out) ?? p.out, unit(p.in) ?? p.in));
  if (!dir) return withPoint(shape, i, { ...p, kind: "smooth" });
  return withPoint(shape, i, { ...p, kind: "smooth", out: scale(dir, length(p.out)), in: scale(dir, -length(p.in)) });
}

/**
 * Point `i`'s handle on `side` dragged to `offset`, or (null) back onto its point, which removes it and leaves that
 * side straight: a smooth point is a corner then, keeping its other handle. A smooth point turns its other handle to
 * stay in line, keeping its length, and stores both; with `alone` (Alt held) it becomes a corner and only this
 * handle moves.
 */
export function withHandle(shape: Shape, i: number, side: Side, offset: Offset | null, alone = false): Shape {
  const p = shape.points[i];
  const acting = handlesOf(shape)[i];
  const other = side === "in" ? "out" : "in";
  const rest = { x: p.x, y: p.y, ...(acting[other] && { [other]: acting[other] }) };
  if (!offset) {
    if (p.kind === "smooth") return withPoint(shape, i, { ...rest, kind: "corner" });
    const { [side]: _gone, ...kept } = p;
    return withPoint(shape, i, kept);
  }
  if (p.kind === "corner") return withPoint(shape, i, { ...p, [side]: offset });
  if (alone) return withPoint(shape, i, { ...rest, kind: "corner", [side]: offset });
  const turned = acting[other] && scale(unit(offset) ?? offset, -length(acting[other]));
  return withPoint(shape, i, { x: p.x, y: p.y, kind: "smooth", [side]: offset, ...(turned && { [other]: turned }) });
}

/**
 * The shape with a corner point added at the middle (t = 0.5) of the edge after point `after`, and its index. On a
 * curve it's the exact de Casteljau split, so the outline doesn't move: the new corner takes the halves' handles,
 * and its neighbours keep their handle directions with the split's lengths (automatic ones stored first).
 */
export function split(shape: Shape, after: number): { shape: Shape; index: number } {
  const e = edgesOf(shape)[after];
  const j = (after + 1) % shape.points.length;
  const at = after + 1;
  if (!e.curved) return { shape: inserted(shape, at, { ...mid(e.a, e.b), kind: "corner" }), index: at };
  const frozen = freeze(freeze(shape, after), j);
  const [p01, p12, p23] = [mid(e.a, e.c1), mid(e.c1, e.c2), mid(e.c2, e.b)];
  const [p012, p123] = [mid(p01, p12), mid(p12, p23)];
  const m = mid(p012, p123);
  let next = withOffset(frozen, after, "out", sub(p01, e.a));
  next = withOffset(next, j, "in", sub(p23, e.b));
  const corner: Point = { ...m, kind: "corner", ...handle("in", sub(p012, m)), ...handle("out", sub(p123, m)) };
  return { shape: inserted(next, at, corner), index: at };
}

/**
 * The shape without point `i`. An open shape's end just goes. Between two straight edges the new edge is straight;
 * otherwise one cubic is fitted to the two old ones: its neighbours stay put, keep their handles' directions (or the
 * old curve's, on a side with none) and take the lengths that fit samples of both old edges best (least squares).
 * Automatic neighbours are stored first.
 */
export function withoutPoint(shape: Shape, i: number): Shape {
  const [u, v] = [neighbour(shape, i, "in"), neighbour(shape, i, "out")];
  const drop = (s: Shape) => ({ ...s, points: s.points.filter((_, k) => k !== i) });
  if (u === null || v === null || u === v) return drop(shape);
  const edges = edgesOf(shape);
  const [e1, e2] = [edges[u], edges[i]];
  if (!e1.curved && !e2.curved) return drop(shape);
  const frozen = freeze(freeze(shape, u), v);
  const du = leaving(e1.a, [e1.c1, e1.c2, e1.b]);
  const dv = leaving(e2.b, [e2.c2, e2.c1, e2.a]);
  const [a, b] = [e1.a, e2.b];
  const samples = [...edgePolyline(e1, FIT_SAMPLES), ...edgePolyline(e2, FIT_SAMPLES).slice(1)];
  const [alpha, beta] = du && dv ? fitLengths(a, b, du, dv, samples) : [0, 0];
  let next = withOffset(frozen, u, "out", du && scale(du, alpha));
  next = withOffset(next, v, "in", dv && scale(dv, beta));
  return drop(next);
}

/**
 * The handle lengths `alpha` (along `du` from `a`) and `beta` (along `dv` from `b`) whose cubic from `a` to `b`
 * passes closest to `samples` (in order from `a` to `b`, taken at chord-length parameters): the 2 × 2 normal
 * equations of least squares, with a negative length held at 0 and the other refitted alone.
 */
function fitLengths(a: XY, b: XY, du: XY, dv: XY, samples: XY[]): [number, number] {
  const along = [0];
  for (let k = 1; k < samples.length; k++) along.push(along[k - 1] + distance(samples[k - 1], samples[k]));
  const total = along[along.length - 1] || 1;
  let [s11, s12, s22, r1, r2] = [0, 0, 0, 0, 0];
  samples.forEach((q, k) => {
    const t = along[k] / total;
    const s = 1 - t;
    const [w0, w1, w2, w3] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
    const r = { x: q.x - (w0 + w1) * a.x - (w2 + w3) * b.x, y: q.y - (w0 + w1) * a.y - (w2 + w3) * b.y };
    s11 += w1 * w1;
    s12 += w1 * w2 * dot(du, dv);
    s22 += w2 * w2;
    r1 += w1 * dot(du, r);
    r2 += w2 * dot(dv, r);
  });
  const det = s11 * s22 - s12 * s12;
  let [alpha, beta] = Math.abs(det) > 1e-12 ? [(r1 * s22 - r2 * s12) / det, (s11 * r2 - s12 * r1) / det] : [-1, -1];
  if (alpha < 0 && beta < 0) return [distance(a, b) / 3, distance(a, b) / 3];
  if (alpha < 0) [alpha, beta] = [0, Math.max(0, r2 / s22)];
  else if (beta < 0) [alpha, beta] = [Math.max(0, r1 / s11), 0];
  return [alpha, beta];
}

/** The direction a curve leaves `from`: towards the first of `towards` that isn't on it. */
function leaving(from: XY, towards: XY[]): XY | null {
  for (const p of towards) {
    const d = unit(sub(p, from));
    if (d) return d;
  }
  return null;
}

/** Point `i` with its automatic handles stored, so a change nearby doesn't work them out afresh. */
function freeze(shape: Shape, i: number): Shape {
  const p = shape.points[i];
  if (p.kind !== "smooth" || (p.in && p.out)) return shape;
  return withPoint(shape, i, { ...p, ...handlesOf(shape)[i] });
}

/** Point `i` with its handle on `side` set to `offset`, or removed when it's null or too short to bend anything. */
function withOffset(shape: Shape, i: number, side: Side, offset: Offset | null): Shape {
  const { [side]: _old, ...p } = shape.points[i];
  return withPoint(shape, i, { ...p, ...handle(side, offset) });
}

/** `{ [side]: offset }`, or nothing for a missing or zero-length one. */
function handle(side: Side, offset: Offset | null): Partial<Point> {
  return offset && length(offset) > 1e-12 ? { [side]: offset } : {};
}

function withPoint(shape: Shape, i: number, point: Point): Shape {
  return { ...shape, points: shape.points.map((p, k) => (k === i ? point : p)) };
}

function inserted(shape: Shape, at: number, point: Point): Shape {
  const points = [...shape.points];
  points.splice(at, 0, point);
  return { ...shape, points };
}

const xy = (p: XY): XY => ({ x: p.x, y: p.y });
const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: XY, k: number): XY => ({ x: a.x * k, y: a.y * k });
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dot = (a: XY, b: XY): number => a.x * b.x + a.y * b.y;
const length = (a: XY): number => Math.hypot(a.x, a.y);
const distance = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);
/** `a` scaled to length 1, or null when it has no direction. */
function unit(a: XY): XY | null {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : null;
}
