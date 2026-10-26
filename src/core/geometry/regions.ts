import type { BBox, Point2 } from "../types";
import { signedArea } from "./distanceField";
import { boundingBox, insidePolygon } from "./polygon";

/** One region the design's edges divide the plane into: carved (inside an odd number of paths) or not. */
export interface Region {
  /** Its boundary: the outer loop first, then a loop round each piece of the design inside it. Fill even-odd. */
  outline: Point2[][];
  /** The outer loop's box. */
  bbox: BBox;
  carved: boolean;
}

/** How a design's closed paths divide the plane, filled even-odd. */
export interface Arrangement {
  /** Each place where two edges cross (one path's own, or two paths'). Touching edges don't cross. */
  crossings: Point2[];
  /**
   * The bounded regions between the edges. Regions that meet only at crossings are separate, so the lens where
   * two paths overlap is a region of its own.
   */
  regions: Region[];
}

/** A straight edge of a path, from vertex `a` to `b`, and the crossings along it (`t`: 0 at `a`, 1 at `b`). */
interface Segment {
  a: number;
  b: number;
  splits: { t: number; vertex: number }[];
}

/**
 * The crossings and regions of closed polylines (implicitly closed, in any direction). Edges are split where they
 * cross into a planar graph whose faces are the regions; points that merely coincide are kept apart, as if nudged.
 */
export function arrange(paths: Point2[][]): Arrangement {
  const vertices: Point2[] = [];
  const segments: Segment[] = [];
  for (const path of paths) {
    const loop = path.filter((p, i) => !samePoint(p, path[(i + 1) % path.length]));
    if (loop.length < 3) continue;
    const first = vertices.length;
    vertices.push(...loop);
    loop.forEach((_, i) => segments.push({ a: first + i, b: first + ((i + 1) % loop.length), splits: [] }));
  }
  const crossings = findCrossings(vertices, segments);
  return { crossings, regions: traceRegions(vertices, segments) };
}

function samePoint(p: Point2, q: Point2): boolean {
  return p.x === q.x && p.y === q.y;
}

/** Twice the signed area of triangle a, b, c: positive when c is left of a → b. */
function orient(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** About this many segments share a cell of the grid that finds crossings. */
const SEGMENTS_PER_CELL = 4;

/**
 * Every proper crossing between two segments (each strictly between its ends), added as a new vertex and recorded
 * on both segments. Segments are bucketed in a grid by their boxes, and each pair is tested once, in the first cell
 * both boxes cover.
 */
function findCrossings(vertices: Point2[], segments: Segment[]): Point2[] {
  const crossings: Point2[] = [];
  if (segments.length === 0) return crossings;
  const box = boundingBox(vertices);
  const side = Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1;
  const n = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(segments.length / SEGMENTS_PER_CELL))));
  const cellOf = (offset: number) => Math.min(n - 1, Math.floor((offset * n) / side));
  const ranges = segments.map((s) => {
    const p = vertices[s.a], q = vertices[s.b];
    return {
      i0: cellOf(Math.min(p.x, q.x) - box.minX),
      i1: cellOf(Math.max(p.x, q.x) - box.minX),
      j0: cellOf(Math.min(p.y, q.y) - box.minY),
      j1: cellOf(Math.max(p.y, q.y) - box.minY),
    };
  });
  const cells = new Map<number, number[]>();
  ranges.forEach((r, k) => {
    for (let i = r.i0; i <= r.i1; i++) {
      for (let j = r.j0; j <= r.j1; j++) {
        const list = cells.get(i * n + j);
        if (list) list.push(k);
        else cells.set(i * n + j, [k]);
      }
    }
  });
  cells.forEach((list, cell) => {
    const i = Math.floor(cell / n), j = cell % n;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const u = ranges[list[x]], v = ranges[list[y]];
        if (Math.max(u.i0, v.i0) !== i || Math.max(u.j0, v.j0) !== j) continue;
        const cur = segments[list[x]], other = segments[list[y]];
        const p1 = vertices[cur.a], p2 = vertices[cur.b], q1 = vertices[other.a], q2 = vertices[other.b];
        const d1 = orient(q1, q2, p1), d2 = orient(q1, q2, p2), d3 = orient(p1, p2, q1), d4 = orient(p1, p2, q2);
        if (!(d1 * d2 < 0 && d3 * d4 < 0)) continue;
        const t = d1 / (d1 - d2);
        const at = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
        const vertex = vertices.push(at) - 1;
        crossings.push(at);
        cur.splits.push({ t, vertex });
        other.splits.push({ t: d3 / (d3 - d4), vertex });
      }
    }
  });
  return crossings;
}

/**
 * The bounded faces of the planar graph the split segments make, with their parity. Each face's boundary is traced
 * with the face on its left: counterclockwise loops are outer boundaries, clockwise ones are a connected piece's
 * outside, which becomes a hole in the face around it (the smallest face of another piece containing it).
 */
function traceRegions(vertices: Point2[], segments: Segment[]): Region[] {
  // Half-edges 2e and 2e + 1 run along edge e in opposite directions; each knows its start and its direction.
  const from: number[] = [];
  const angle: number[] = [];
  const parent = vertices.map((_, i) => i);
  // Which connected piece of the graph a vertex is in (union-find, iterative: a path's chain can be long).
  const root = (v: number): number => {
    let r = v;
    while (parent[r] !== r) r = parent[r];
    for (let next = parent[v]; v !== r; v = next, next = parent[v]) parent[v] = r;
    return r;
  };
  for (const s of segments) {
    const p = vertices[s.a], q = vertices[s.b];
    const forward = Math.atan2(q.y - p.y, q.x - p.x);
    const backward = Math.atan2(p.y - q.y, p.x - q.x);
    const chain = [s.a, ...s.splits.sort((u, v) => u.t - v.t).map((x) => x.vertex), s.b];
    for (let i = 0; i + 1 < chain.length; i++) {
      from.push(chain[i], chain[i + 1]);
      angle.push(forward, backward);
      parent[root(chain[i])] = root(chain[i + 1]);
    }
  }
  const twin = (h: number) => h ^ 1;
  const outgoing: number[][] = vertices.map(() => []);
  from.forEach((v, h) => outgoing[v].push(h));
  const place: number[] = [];
  for (const list of outgoing) {
    list.sort((u, v) => angle[u] - angle[v]);
    list.forEach((h, i) => (place[h] = i));
  }
  // With the face on the left, the next half-edge is the one just clockwise of the way back.
  const next = (h: number) => {
    const list = outgoing[from[twin(h)]];
    return list[(place[twin(h)] - 1 + list.length) % list.length];
  };

  const cycles: { edges: number[]; loop: Point2[]; area: number }[] = [];
  const cycleOf: number[] = [];
  for (let h = 0; h < from.length; h++) {
    if (cycleOf[h] !== undefined) continue;
    const edges: number[] = [];
    for (let e = h; cycleOf[e] === undefined; e = next(e)) {
      cycleOf[e] = cycles.length;
      edges.push(e);
    }
    const loop = edges.map((e) => vertices[from[e]]);
    cycles.push({ edges, loop, area: signedArea(loop) });
  }

  const box = boundingBox(vertices);
  // Loops enclosing less than this are degenerate (e.g. a path doubling back on itself) and bound no face.
  const degenerate = ((box.maxX - box.minX) ** 2 + (box.maxY - box.minY) ** 2) * 1e-12;
  // Faces are the counterclockwise loops; the last face is the unbounded one outside everything.
  const outers = cycles.flatMap((c, i) => (c.area > degenerate ? [i] : []));
  const unbounded = outers.length;
  const faceOfCycle = new Map(outers.map((c, f) => [c, f]));
  const boxes = outers.map((c) => boundingBox(cycles[c].loop));
  const component = (c: number) => root(from[cycles[c].edges[0]]);
  cycles.forEach((c, i) => {
    if (c.area >= -degenerate) return;
    const p = c.loop[0];
    let best = unbounded, bestArea = Infinity;
    outers.forEach((o, f) => {
      const b = boxes[f];
      if (cycles[o].area >= bestArea || component(o) === component(i)) return;
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY || !insidePolygon(p, cycles[o].loop)) return;
      best = f;
      bestArea = cycles[o].area;
    });
    faceOfCycle.set(i, best);
  });

  // Crossing an edge flips the parity; outside everything is uncarved.
  const cyclesOfFace: number[][] = Array.from({ length: unbounded + 1 }, () => []);
  faceOfCycle.forEach((f, c) => cyclesOfFace[f].push(c));
  const parity: (number | undefined)[] = [];
  parity[unbounded] = 0;
  const queue = [unbounded];
  for (let k = 0; k < queue.length; k++) {
    const f = queue[k];
    for (const c of cyclesOfFace[f]) {
      for (const h of cycles[c].edges) {
        const g = faceOfCycle.get(cycleOf[twin(h)]);
        if (g === undefined || parity[g] !== undefined) continue;
        parity[g] = 1 - parity[f]!;
        queue.push(g);
      }
    }
  }

  return outers.flatMap((_, f) =>
    parity[f] === undefined
      ? []
      : [{ outline: cyclesOfFace[f].map((k) => cycles[k].loop), bbox: boxes[f], carved: parity[f] === 1 }],
  );
}
