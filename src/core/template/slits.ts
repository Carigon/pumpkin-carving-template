import { meshTopology, type TriangleMesh } from "../flatten/mesh";
import { distanceToSegment, insidePolygon, nearestOnPolygon, pieceInside } from "../geometry/polygon";
import { segmentDistance } from "../geometry/segmentIndex";
import { distance } from "../geometry/vector";
import type { Point2 } from "../types";
import type { CutRegion } from "./cutOutline";

export interface SlitPlanOptions {
  /** How far a slit may run in from the cut-out edge. */
  depth: number;
  /** Least distance between a slit and any design path. */
  clearance: number;
  /** Least distance between two slits. */
  spacing: number;
  /** A slit that can't get this far in from the edge isn't placed. */
  minDepth: number;
}

/** Candidate slits tried for each new slit, spread evenly around the cut-out edge. */
export const CANDIDATES = 8;
/** Moving a slit's start along the edge costs this much per unit length, against 1 for running through the paper. */
const SHIFT_COST = 0.5;
/** A slit's path through the paper may be at most this many times the depth, so it can't snake along gaps. */
const MAX_PATH = 1.25;
/** A printed slit may stray this many mesh edges from the cut it straightens (see `pullTaut`). */
const MAX_STRAIGHTEN = 1.5;
/** Each round's candidates are turned this fraction of their spacing from the last round's (the golden ratio's). */
const TURN = (Math.sqrt(5) - 1) / 2;

/** Finds slits to try on a mesh, keeping clear of the design and of the slits already kept. */
export interface SlitPlanner {
  /**
   * Up to `CANDIDATES` slits for round `round` (0 for the first slit, 1 for the second, ...), as chains of
   * edge-adjacent mesh vertices from the mesh boundary to the tip. Each round's candidates sit at other places
   * along the edge.
   */
  candidates(round: number): number[][];
  /** Keep a slit: later candidates share no vertices with it and stay the spacing away from it. */
  take(chain: number[]): void;
}

/**
 * Slits on a mesh whose vertices sit at `positions` (a layout close to the paper), inside `region` (design lines
 * and cut-out edge in the same layout). The edge is split into `CANDIDATES` equal stretches; the candidate for each
 * starts on the edge in it (preferring its middle) and runs inward along the shortest path through blank paper,
 * bending around design lines, until it is `depth` in from the edge or its path is `MAX_PATH` times the depth (then
 * re-routed between the same ends to run as straight as the mesh allows).
 * Where blank paper runs out first, it stops at the deepest point it could reach; under `minDepth`, there's no
 * candidate there. Each slit also runs outward to the mesh boundary so cutting it really opens the mesh.
 */
export function slitPlanner(mesh: TriangleMesh, positions: Point2[], region: CutRegion, options: SlitPlanOptions): SlitPlanner {
  const { depth } = options;
  const { neighbors, boundary } = meshTopology(mesh);
  const spacing = medianEdge(mesh, positions);
  const slack = region.resolution + spacing / 4;
  // The paper opens up along a slit, moving its sides: keep at least half a mesh edge clear.
  const clearance = Math.max(options.clearance, spacing / 2);
  const tolerance = spacing / 2;
  const minDepth = Math.min(options.minDepth, depth) - tolerance;
  const maxPath = MAX_PATH * depth;

  const n = positions.length;
  const edge = positions.map((p) => region.edgeDistance(p));
  const inside = edge.map((e) => e < 0);
  const toDesign = positions.map((p, v) => (inside[v] ? region.designDistance(p) : Infinity));
  const clear = toDesign.map((d) => d >= clearance);
  const edgeChecked = new Map<number, boolean>();
  const edgeClear = (a: number, b: number) => {
    const p = positions[a], q = positions[b];
    const length = distance(p, q);
    // Every point of the edge is within half its length of an end.
    if (Math.min(toDesign[a], toDesign[b]) - length / 2 >= clearance) return true;
    const key = Math.min(a, b) * n + Math.max(a, b);
    let ok = edgeChecked.get(key);
    if (ok === undefined) {
      // Sampled every half clearance, so a design line crossing the edge comes within a quarter clearance of a sample.
      ok = true;
      const pieces = Math.max(2, Math.ceil((2 * length) / clearance));
      for (let i = 1; i < pieces && ok; i++) {
        const t = i / pieces;
        ok = region.designDistance({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }) >= clearance;
      }
      edgeChecked.set(key, ok);
    }
    return ok;
  };
  /** Vertices of kept slits and their neighbours: no other slit may use them. */
  const taken = new Uint8Array(n);
  /** Vertices within the spacing of a kept slit: no other slit may run through them. */
  const crowded = new Uint8Array(n);

  // The vertices a slit may start from, and how far along the edge each sits.
  const outline = region.outline;
  const along = arcLength(outline);
  const perimeter = along[outline.length];
  const starts: { v: number; at: number }[] = [];
  for (let v = 0; v < n; v++) {
    if (inside[v] || edge[v] > slack || !neighbors[v].some((w) => inside[w])) continue;
    starts.push({ v, at: positionAlong(positions[v], outline, along) });
  }

  const cost = new Float64Array(n);
  const length = new Float64Array(n);
  const from = new Int32Array(n);
  const done = new Uint8Array(n);

  /** Shortest path inward from the stretch of edge from `lo` to `lo + stretch` along it, preferring its middle. */
  const inward = (lo: number, stretch: number): number[] | null => {
    cost.fill(Infinity);
    from.fill(-1);
    done.fill(0);
    const heap = new MinHeap();
    for (const { v, at } of starts) {
      const offset = (((at - lo) % perimeter) + perimeter) % perimeter;
      if (offset >= stretch || crowded[v]) continue;
      cost[v] = SHIFT_COST * Math.abs(offset - stretch / 2);
      length[v] = 0;
      heap.push(v, cost[v]);
    }
    let deepest = 0;
    const reached: number[] = [];
    while (heap.size) {
      const v = heap.pop();
      if (done[v]) continue;
      done[v] = 1;
      if (inside[v]) {
        reached.push(v);
        deepest = Math.max(deepest, -edge[v]);
      }
      if (-edge[v] >= depth - tolerance) break;
      for (const w of neighbors[v]) {
        if (done[w] || !inside[w] || crowded[w] || !clear[w] || !edgeClear(v, w)) continue;
        const step = distance(positions[v], positions[w]);
        if (length[v] + step > maxPath) continue;
        const c = cost[v] + step;
        if (c < cost[w]) {
          cost[w] = c;
          length[w] = length[v] + step;
          from[w] = v;
          heap.push(w, c);
        }
      }
    }
    if (deepest < minDepth) return null;
    // The tip: the cheapest vertex about as deep as any reached (so a short slit doesn't wander sideways).
    const goal = Math.min(depth, deepest) - tolerance;
    const tip = reached.find((v) => -edge[v] >= goal) ?? -1;
    const path: number[] = [];
    for (let v = tip; v >= 0; v = from[v]) path.push(v);
    return path.length >= 2 ? alongTautLine(path.reverse()) : null;
  };

  /** Can a straight cut run from vertex `a` to vertex `b`: clear of the design and on (or just past) the paper? */
  const sees = (a: number, b: number): boolean => {
    if (!edgeClear(a, b)) return false;
    const p = positions[a], q = positions[b];
    const pieces = Math.ceil((2 * distance(p, q)) / spacing);
    for (let i = 1; i < pieces; i++) {
      const t = i / pieces;
      if (region.edgeDistance({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }) > slack) return false;
    }
    return true;
  };

  /**
   * The same slit as `path`, re-routed to hug its taut line. Many chains of mesh edges between two vertices are
   * about as short (on a grid, every order of the same axis and diagonal steps), and the shortest path finds any of
   * them: often all the diagonal steps first, then the straight ones, a bend too wide for `pullTaut` to straighten.
   * So pull the path taut (from its start, on to the furthest vertex it `sees`), then find the chain between the
   * same ends that strays least from that line: each step costs its length, plus more the further from the line it ends.
   */
  const alongTautLine = (path: number[]): number[] => {
    const line = [path[0]];
    for (let i = 0; i < path.length - 1; ) {
      let j = path.length - 1;
      while (j > i + 1 && !sees(path[i], path[j])) j--;
      line.push(path[j]);
      i = j;
    }
    const guide = line.map((v) => positions[v]);
    const offLine = (p: Point2) => Math.min(...guide.slice(1).map((q, i) => distanceToSegment(p, guide[i], q))) / spacing;
    const [start, tip] = [path[0], path[path.length - 1]];
    cost.fill(Infinity);
    from.fill(-1);
    done.fill(0);
    const heap = new MinHeap();
    cost[start] = 0;
    heap.push(start, 0);
    while (heap.size) {
      const v = heap.pop();
      if (done[v]) continue;
      done[v] = 1;
      if (v === tip) break;
      for (const w of neighbors[v]) {
        if (done[w] || !inside[w] || crowded[w] || !clear[w] || !edgeClear(v, w)) continue;
        const c = cost[v] + distance(positions[v], positions[w]) * (1 + offLine(positions[w]) ** 2);
        if (c < cost[w]) {
          cost[w] = c;
          from[w] = v;
          heap.push(w, c);
        }
      }
    }
    // The path itself is one way through, so the tip is always reached.
    const hugging: number[] = [];
    for (let v = tip; v >= 0; v = from[v]) hugging.push(v);
    return hugging.reverse();
  };

  /** From an edge vertex, step outward (away from the paper) to the mesh boundary. */
  const outward = (start: number): number[] => {
    const path = [start];
    const seen = new Set(path);
    let v = start;
    while (!boundary[v]) {
      let best = -1;
      for (const w of neighbors[v]) {
        if (seen.has(w) || inside[w] || taken[w]) continue;
        if (best < 0 || edge[w] > edge[best]) best = w;
      }
      if (best < 0 || edge[best] < edge[v] - spacing / 4) break;
      path.push(best);
      seen.add(best);
      v = best;
    }
    return path;
  };

  return {
    candidates(round) {
      const stretch = perimeter / CANDIDATES;
      const turn = ((round * TURN) % 1) * stretch;
      const chains: number[][] = [];
      const tips = new Set<number>();
      for (let k = 0; k < CANDIDATES; k++) {
        const path = inward(turn + k * stretch, stretch);
        if (!path || tips.has(path[path.length - 1])) continue;
        tips.add(path[path.length - 1]);
        chains.push([...outward(path[0]).reverse(), ...path.slice(1)]);
      }
      return chains;
    },
    take(chain) {
      const line = chain.map((v) => positions[v]);
      for (let v = 0; v < n; v++) {
        for (let i = 0; i + 1 < line.length && !crowded[v]; i++) {
          if (distanceToSegment(positions[v], line[i], line[i + 1]) < options.spacing) crowded[v] = 1;
        }
      }
      for (const v of chain) {
        crowded[v] = taken[v] = 1;
        for (const w of neighbors[v]) taken[w] = 1;
      }
    },
  };
}

/**
 * Finish the planned slits on paper. `lines` are the cut slits on paper (in along one side to the tip at
 * `tips[s]`, out along the other), running past the cut-out edge. Each is trimmed at the edge, and its tip
 * is carried on straight ahead (the mesh only cuts along its edges) until the slit is `depth` in from the
 * edge, comes `clearance` from a design line or `spacing` from another slit. Then each side is pulled taut so it
 * cuts cleanly (see `pullTaut`).
 */
export function finishSlits(
  lines: Point2[][],
  tips: number[],
  outline: Point2[],
  design: Point2[][],
  { depth, clearance, spacing }: Pick<SlitPlanOptions, "depth" | "clearance" | "spacing">,
): Point2[][] {
  const toDesign = segmentDistance(design, 2 * clearance);
  const toEdge = (p: Point2) => nearestOnPolygon(p, outline).distance;
  const slits: Point2[][] = [];
  lines.forEach((line, s) => {
    const tip = line[tips[s]];
    const others = lines.filter((_, o) => o !== s);
    const crowded = (p: Point2) => others.some((other) => other.some((q, i) => i > 0 && distanceToSegment(p, other[i - 1], q) < spacing));
    // Carry on straight away from the nearest point of the edge: the quickest way deeper.
    const { point: from, distance: d0 } = nearestOnPolygon(tip, outline);
    let end = tip, reached = d0;
    if (d0 > 0 && insidePolygon(tip, outline)) {
      const dir = { x: (tip.x - from.x) / d0, y: (tip.y - from.y) / d0 };
      const step = clearance / 4;
      for (let t = step; reached < depth; t += step) {
        const p = { x: tip.x + t * dir.x, y: tip.y + t * dir.y };
        const deeper = toEdge(p);
        // Stop at the design, or where going on wouldn't take the slit deeper into the paper.
        if (toDesign(p) < clearance || deeper < reached + step / 4 || !insidePolygon(p, outline) || crowded(p)) break;
        [end, reached] = [p, deeper];
      }
    }
    const extended = end === tip ? line : [...line.slice(0, tips[s] + 1), end, ...line.slice(tips[s])];
    const taut = pullTaut(extended, end === tip ? tips[s] : tips[s] + 1, (p) => toDesign(p) >= clearance, clearance / 4);
    const piece = pieceInside(taut.line, taut.apex, outline);
    if (piece && piece.length >= 2) slits.push(piece);
  });
  return slits;
}

/**
 * Straighten a slit for cutting. The mesh cuts only along its edges, so each side of a slit staircases from
 * vertex to vertex. Pull each side taut from the tip at `apex` outward: skip ahead to the furthest vertex whose
 * straight segment stays `clear` of the design (sampled every `step`) and within `MAX_STRAIGHTEN` mesh edges of
 * the vertices it skips, so the printed slit stays on the cut the paper was flattened with.
 */
function pullTaut(line: Point2[], apex: number, clear: (p: Point2) => boolean, step: number): { line: Point2[]; apex: number } {
  const steps = line.slice(1).map((p, i) => distance(line[i], p)).sort((a, b) => a - b);
  const reach = MAX_STRAIGHTEN * (steps[Math.floor(steps.length / 2)] ?? 0);
  const straight = (side: Point2[], i: number, j: number) => {
    const a = side[i], b = side[j];
    for (let k = i + 1; k < j; k++) if (distanceToSegment(side[k], a, b) > reach) return false;
    const pieces = Math.ceil(distance(a, b) / step);
    for (let t = 1; t < pieces; t++) {
      if (!clear({ x: a.x + ((b.x - a.x) * t) / pieces, y: a.y + ((b.y - a.y) * t) / pieces })) return false;
    }
    return true;
  };
  // `side[0]` is the tip; the next vertex is always kept, so a slit no straighter than the mesh stays as it was.
  const pull = (side: Point2[]) => {
    const kept = [side[0]];
    for (let i = 0; i < side.length - 1; ) {
      let j = side.length - 1;
      while (j > i + 1 && !straight(side, i, j)) j--;
      kept.push(side[j]);
      i = j;
    }
    return kept;
  };
  const inward = pull(line.slice(0, apex + 1).reverse()).reverse();
  return { line: [...inward, ...pull(line.slice(apex)).slice(1)], apex: inward.length - 1 };
}

function medianEdge({ triangles }: TriangleMesh, positions: Point2[]): number {
  const lengths = triangles.map(([a, b]) => distance(positions[a], positions[b])).sort((x, y) => x - y);
  return lengths[Math.floor(lengths.length / 2)] ?? 1;
}

/** Length along a closed polygon up to each vertex; the last entry (one past the end) is the perimeter. */
function arcLength(polygon: Point2[]): number[] {
  const along = [0];
  polygon.forEach((p, i) => along.push(along[i] + distance(p, polygon[(i + 1) % polygon.length])));
  return along;
}

/** How far along a closed polygon (see `arcLength`) its point nearest to `p` sits. */
function positionAlong(p: Point2, polygon: Point2[], along: number[]): number {
  let best = Infinity, at = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const d = distanceToSegment(p, a, b);
    if (d >= best) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = d;
    at = along[i] + t * (along[i + 1] - along[i]);
  }
  return at;
}

/** Binary min-heap of vertex ids by priority (duplicates allowed; skip stale entries on pop). */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      ids[i] = ids[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const { ids, keys } = this;
    const top = ids[0];
    const id = ids.pop()!, key = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= ids.length) break;
        if (child + 1 < ids.length && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        ids[i] = ids[child];
        keys[i] = keys[child];
        i = child;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}
