/**
 * Edit as hand-trace on an SVG design (spec #27, #20): the curve-keeping SVG reader. It reads the shapes an SVG
 * draws as `readSvgDesign` does, but keeps their curves as points and handles, and lands them on a page shaped to
 * the design's box (ADR 0003). Needs the DOM.
 */
import svgpath from "svgpath";
import type { HandTraceRecord, Offset, Page, Point, Shape } from "../handTrace";
import { RELATIVE_TOLERANCE } from "./pathDesign";
import { readSvgDesign, svgPaths, svgRoot, type SvgPath } from "./svgDesign";

/** The room round an edited SVG design on its page, all round, as a fraction of the design's long side. */
const PAGE_MARGIN = 0.1;
/** Two handles in line within this many degrees make their point smooth; any further apart, a corner. */
const SMOOTH_DEGREES = 1;
/** Points (and handle tips) closer than this, as a fraction of the loader's tolerance, are the same place. */
const SAME_PLACE = 0.1;

/** An SVG design as a hand-trace: the page it lands on, and its shapes on that page. */
export interface SvgHandTrace {
  page: Page;
  handTrace: HandTraceRecord;
}

/** A position in some 2D space. */
interface XY {
  x: number;
  y: number;
}

/** One piece of a subpath as a cubic from `a` to `b`; a straight one (`curved` false) has its handles at its ends. */
interface Segment {
  a: XY;
  c1: XY;
  c2: XY;
  b: XY;
  curved: boolean;
}

/**
 * The SVG design in `text` as a hand-trace, looking exactly as it did: each subpath a closed shape (open ones closed
 * by a straight edge, as the loader closes them), in the order drawn, with `mirror: "none"`. Cubics map one to one,
 * quadratics are raised to cubics exactly and arcs become cubics of at most 90°; every handle is stored, and a point
 * is smooth when its two handles are in line. The page is the design's box (as the loader reads it) plus 10% of its
 * long side all round, one unit across, so the symmetry axis runs down the box's middle. Null when the loader finds
 * no shape with an area.
 */
export function readSvgHandTrace(text: string): SvgHandTrace | null {
  const { design } = readSvgDesign(text);
  const root = svgRoot(text);
  if (!design || !root) return null;
  const box = design.bbox;
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY];
  const margin = PAGE_MARGIN * Math.max(w, h);
  const across = w + 2 * margin;
  // SVG space is y down: flipped as the loader flips it, then moved in by the margin and scaled to one unit across.
  const toPage = ({ x, y }: XY): XY => ({ x: (x - box.minX + margin) / across, y: (-y - box.minY + margin) / across });
  const same = (SAME_PLACE * RELATIVE_TOLERANCE * Math.max(w, h)) / across;

  const shapes: Shape[] = [];
  for (const path of svgPaths(root).paths) {
    for (const loop of loopsOf(path)) {
      const points = pointsOf(loop.map((s) => mapped(s, toPage)), same);
      if (points.length > 0) shapes.push({ id: shapes.length + 1, closed: true, mirror: "none", points });
    }
  }
  return { page: { width: 1, height: (h + 2 * margin) / across }, handTrace: { shapes, drawing: null, done: false } };
}

/** Each subpath of `path`'s data, transforms applied, as segments in SVG space. */
function loopsOf({ d, transform }: SvgPath): Segment[][] {
  const loops: Segment[][] = [];
  let loop: Segment[] = [];
  const end = () => {
    if (loop.length > 0) loops.push(loop);
    loop = [];
  };
  const line = (a: XY, b: XY) => loop.push({ a, c1: a, c2: b, b, curved: false });
  // The loader's own route (`flattenPathData`): arcs become cubics of at most 90° there too.
  svgpath(d)
    .transform(transform)
    .unshort()
    .unarc()
    .abs()
    .iterate((s, _i, x, y) => {
      const a = { x, y };
      switch (s[0]) {
        case "M":
        case "Z":
        case "z":
          return end();
        case "L":
          return void line(a, { x: s[1], y: s[2] });
        case "H":
          return void line(a, { x: s[1], y });
        case "V":
          return void line(a, { x, y: s[1] });
        case "C":
          return void loop.push({ a, c1: { x: s[1], y: s[2] }, c2: { x: s[3], y: s[4] }, b: { x: s[5], y: s[6] }, curved: true });
        case "Q": {
          // Raised to a cubic exactly: each handle two thirds of the way to the control point.
          const [q, b] = [{ x: s[1], y: s[2] }, { x: s[3], y: s[4] }];
          return void loop.push({ a, c1: lerp(a, q, 2 / 3), c2: lerp(b, q, 2 / 3), b, curved: true });
        }
      }
    });
  end();
  return loops;
}

/**
 * A closed shape's points from one subpath's segments: zero-length pieces dropped, closed by a straight edge when
 * it doesn't end where it started, and a curve split in two while there are fewer than 3 points (so a lens drawn
 * with two cubics keeps its look). Empty when nothing with a length is left, or it's straight with under 3 points.
 * Points closer than `same` are one place.
 */
function pointsOf(loop: readonly Segment[], same: number): Point[] {
  const at = (p: XY, q: XY) => Math.hypot(p.x - q.x, p.y - q.y) <= same;
  const segs = loop.filter((s) => !(at(s.a, s.b) && (!s.curved || (at(s.a, s.c1) && at(s.b, s.c2)))));
  if (segs.length === 0) return [];
  const [start, end] = [segs[0].a, segs[segs.length - 1].b];
  if (!at(end, start)) segs.push({ a: end, c1: end, c2: start, b: start, curved: false });
  while (segs.length < 3) {
    const i = segs.findIndex((s) => s.curved);
    if (i < 0) return [];
    segs.splice(i, 1, ...halves(segs[i]));
  }
  const handle = (tip: XY, from: XY): Offset | undefined => (at(tip, from) ? undefined : { x: tip.x - from.x, y: tip.y - from.y });
  return segs.map((s, i) => {
    const before = segs[(i + segs.length - 1) % segs.length];
    const [hIn, hOut] = [before.curved ? handle(before.c2, s.a) : undefined, s.curved ? handle(s.c1, s.a) : undefined];
    const kind = hIn && hOut && inLine(hIn, hOut) ? "smooth" : "corner";
    return { x: s.a.x, y: s.a.y, kind, ...(hIn && { in: hIn }), ...(hOut && { out: hOut }) };
  });
}

/** A point's in and out handles point opposite ways within `SMOOTH_DEGREES`. */
function inLine(hIn: Offset, hOut: Offset): boolean {
  const cross = hOut.x * -hIn.y - hOut.y * -hIn.x;
  const dot = hOut.x * -hIn.x + hOut.y * -hIn.y;
  return Math.atan2(Math.abs(cross), dot) <= (SMOOTH_DEGREES * Math.PI) / 180;
}

/** A curved segment split at its middle (de Casteljau): the same curve, as two. */
function halves({ a, c1, c2, b }: Segment): Segment[] {
  const [p, q, r] = [lerp(a, c1, 0.5), lerp(c1, c2, 0.5), lerp(c2, b, 0.5)];
  const [pq, qr] = [lerp(p, q, 0.5), lerp(q, r, 0.5)];
  const mid = lerp(pq, qr, 0.5);
  return [
    { a, c1: p, c2: pq, b: mid, curved: true },
    { a: mid, c1: qr, c2: r, b, curved: true },
  ];
}

/** Segment `s` with its points mapped through `map` (an affine map, so its curve maps exactly). */
function mapped(s: Segment, map: (p: XY) => XY): Segment {
  return { a: map(s.a), c1: map(s.c1), c2: map(s.c2), b: map(s.b), curved: s.curved };
}

function lerp(a: XY, b: XY, t: number): XY {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
