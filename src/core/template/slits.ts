import { meshTopology, type TriangleMesh } from "../flatten/mesh";
import { distanceToSegment, insidePolygon, nearestOnPolygon, pieceInside } from "../geometry/polygon";
import { segmentDistance } from "../geometry/segmentIndex";
import { distance } from "../geometry/vector";
import type { Point2 } from "../types";
import type { CutRegion } from "./cutOutline";

export interface SlitPlanOptions {
  count: number;
  /** How far each slit runs in from the cut-out edge. */
  depth: number;
  /** Least distance between a slit and any design path. */
  clearance: number;
}

export interface SlitPlan {
  /** Per slit, a chain of edge-adjacent mesh vertices from the mesh boundary to the slit's tip. */
  chains: number[][];
  /** Per slit: did a design line stop it from going deeper? */
  hitDesign: boolean[];
  /** Slits left out because a design line left no room for them. */
  dropped: number;
}

/** Slits may start this fraction of the angle between neighbouring slits to either side of their place. */
const MAX_SHIFT = 0.4;
/** Moving a slit's start sideways costs this much per unit length, against 1 for running through the paper. */
const SHIFT_COST = 0.5;
/** A slit shorter than this fraction of the set depth counts as blocked. */
const BLOCKED_BELOW = 0.5;
/** Give up on bending a slit once its path is this many times longer than the set depth. */
const MAX_DETOUR = 3;
/** A printed slit may stray this many mesh edges from the cut it straightens (see `pullTaut`). */
const MAX_STRAIGHTEN = 1.5;

/**
 * Lay out slits on a mesh whose vertices sit at `positions` (a layout close to the paper), inside `region`
 * (design lines and cut-out edge in the same layout). Slit k belongs at angle 90° + k·360°/count around
 * the design center (the origin; the first one toward the stem). It starts on the cut-out edge near
 * there (moved sideways by up to `MAX_SHIFT` of the spacing) and runs inward along the shortest path
 * through blank paper, bending around design lines, until it is `depth` in from the edge. Where blank
 * paper runs out first, it stops at the deepest point it could reach. Each slit also runs outward to the
 * mesh boundary so cutting it really opens the mesh.
 */
export function planSlits(mesh: TriangleMesh, positions: Point2[], region: CutRegion, options: SlitPlanOptions): SlitPlan {
  const { count, depth } = options;
  if (count <= 0 || depth <= 0) return { chains: [], hitDesign: [], dropped: 0 };
  const { neighbors, boundary } = meshTopology(mesh);
  const spacing = medianEdge(mesh, positions);
  const slack = region.resolution + spacing / 4;
  // The paper opens up along a slit, moving its sides: keep at least half a mesh edge clear.
  const clearance = Math.max(options.clearance, spacing / 2);
  const tolerance = spacing / 2;

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
  const blocked = new Uint8Array(n);
  const angleOf = positions.map((p) => Math.atan2(p.y, p.x));
  const radius = positions.map((p) => Math.hypot(p.x, p.y));

  const cost = new Float64Array(n);
  const from = new Int32Array(n);
  const done = new Uint8Array(n);

  /** Shortest path inward from the edge near `angle`. Returns its vertices (edge first) and the tip's depth. */
  const inward = (angle: number, window: number) => {
    cost.fill(Infinity);
    from.fill(-1);
    done.fill(0);
    const heap = new MinHeap();
    for (let v = 0; v < n; v++) {
      if (inside[v] || blocked[v] || edge[v] > slack || !neighbors[v].some((w) => inside[w])) continue;
      const off = Math.abs(angleDifference(angleOf[v], angle));
      if (off > window) continue;
      cost[v] = SHIFT_COST * off * radius[v];
      heap.push(v, cost[v]);
    }
    let deepest = 0, deepestRejected = -Infinity;
    const reached: number[] = [];
    while (heap.size) {
      const v = heap.pop();
      if (done[v]) continue;
      done[v] = 1;
      if (cost[v] > MAX_DETOUR * depth + window * radius[v]) break;
      if (inside[v]) {
        reached.push(v);
        deepest = Math.max(deepest, -edge[v]);
      }
      if (-edge[v] >= depth - tolerance) break;
      for (const w of neighbors[v]) {
        if (done[w] || !inside[w] || blocked[w]) continue;
        if (!clear[w] || !edgeClear(v, w)) {
          deepestRejected = Math.max(deepestRejected, -edge[w]);
          continue;
        }
        const c = cost[v] + distance(positions[v], positions[w]);
        if (c < cost[w]) {
          cost[w] = c;
          from[w] = v;
          heap.push(w, c);
        }
      }
    }
    // The tip: the cheapest vertex about as deep as any reached (so a short slit doesn't wander sideways).
    const goal = Math.min(depth, deepest) - tolerance;
    const tip = reached.find((v) => -edge[v] >= goal) ?? -1;
    const path: number[] = [];
    for (let v = tip; v >= 0; v = from[v]) path.push(v);
    const tipDepth = tip >= 0 ? -edge[tip] : 0;
    // The design is in the way if it kept the slit from paper deeper than it got.
    return { path: path.reverse(), depth: tipDepth, hitDesign: deepestRejected > tipDepth + tolerance };
  };

  /** From an edge vertex, step outward (away from the paper) to the mesh boundary. */
  const outward = (start: number): number[] => {
    const path = [start];
    const seen = new Set(path);
    let v = start;
    while (!boundary[v]) {
      let best = -1;
      for (const w of neighbors[v]) {
        if (seen.has(w) || inside[w] || blocked[w]) continue;
        if (best < 0 || edge[w] > edge[best]) best = w;
      }
      if (best < 0 || edge[best] < edge[v] - spacing / 4) break;
      path.push(best);
      seen.add(best);
      v = best;
    }
    return path;
  };

  const plan: SlitPlan = { chains: [], hitDesign: [], dropped: 0 };
  const step = (2 * Math.PI) / count;
  for (let k = 0; k < count; k++) {
    const slit = inward(Math.PI / 2 + k * step, MAX_SHIFT * step);
    if (slit.path.length < 2 || slit.depth < spacing / 4) {
      if (slit.hitDesign) plan.dropped++;
      continue;
    }
    const chain = [...outward(slit.path[0]).reverse(), ...slit.path.slice(1)];
    plan.chains.push(chain);
    plan.hitDesign.push(slit.hitDesign);
    for (const v of chain) {
      blocked[v] = 1;
      for (const w of neighbors[v]) blocked[w] = 1;
    }
  }
  return plan;
}

/** The slits as printed, and how many a design line kept well short of their depth. */
export interface PaperSlits {
  /** Open polylines from the cut-out edge in to the tip and back out (see `FlatTemplate.slits`). */
  slits: Point2[][];
  /**
   * How many slits a design line kept under half the set depth, including ones left out. Slits that
   * fall a little short, or are limited by the size of the paper, don't count.
   */
  blocked: number;
}

/**
 * Finish the planned slits on paper. `lines` are the cut slits on paper (in along one side to the tip at
 * `tips[s]`, out along the other), running past the cut-out edge. Each is trimmed at the edge, and its tip
 * is carried on straight ahead (the mesh only cuts along its edges) until the slit is `depth` in from the
 * edge or comes `clearance` from a design line. Then each side is pulled taut so it cuts cleanly (see `pullTaut`).
 */
export function finishSlits(
  lines: Point2[][],
  tips: number[],
  plan: SlitPlan,
  outline: Point2[],
  design: Point2[][],
  { depth, clearance }: SlitPlanOptions,
): PaperSlits {
  const toDesign = segmentDistance(design, 2 * clearance);
  const toEdge = (p: Point2) => nearestOnPolygon(p, outline).distance;
  let blocked = plan.dropped;
  const slits: Point2[][] = [];
  lines.forEach((line, s) => {
    const tip = line[tips[s]];
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
        if (toDesign(p) < clearance || deeper < reached + step / 4 || !insidePolygon(p, outline)) break;
        [end, reached] = [p, deeper];
      }
    }
    const extended = end === tip ? line : [...line.slice(0, tips[s] + 1), end, ...line.slice(tips[s])];
    const taut = pullTaut(extended, end === tip ? tips[s] : tips[s] + 1, (p) => toDesign(p) >= clearance, clearance / 4);
    const piece = pieceInside(taut.line, taut.apex, outline);
    if (piece && piece.length >= 2) slits.push(piece);
    if (plan.hitDesign[s] && reached < BLOCKED_BELOW * depth) blocked++;
  });
  return { slits, blocked };
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

function angleDifference(a: number, b: number): number {
  const d = (a - b) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
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
