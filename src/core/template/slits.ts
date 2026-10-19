import { distanceToSegment, rayExit } from "../geometry/polygon";
import { meshTopology, type TriangleMesh } from "../flatten/mesh";
import type { Point2 } from "../types";

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
  /** How many slits couldn't reach the set depth through blank paper and were shortened (or dropped). */
  shortened: number;
}

/** Try sideways moves up to this fraction of the angle between neighboring slits. */
const MAX_SHIFT = 0.4;

/**
 * Lay out slits in the meshing domain. Slit k starts where the ray from the outline's center at
 * angle 90° + k·360°/count (the first one toward the stem) leaves the cut-out outline and runs
 * `depth` inward, snapped to mesh edges. Each slit continues outward to the mesh boundary so it
 * really opens the mesh. A slit that comes closer than `clearance` to a design path is turned
 * sideways (about the outline's center); if no turn keeps it clear for its whole depth, the
 * longest clear one is kept, shortened to where it would meet the design.
 */
export function planSlits(mesh: TriangleMesh, design: Point2[][], outline: Point2[], options: SlitPlanOptions): SlitPlan {
  const { count, depth } = options;
  if (count <= 0 || depth <= 0 || outline.length < 3) return { chains: [], shortened: 0 };
  const { domain } = mesh;
  const { neighbors, boundary } = meshTopology(mesh);
  const spacing = medianEdge(mesh);
  const clearance = Math.max(options.clearance, 0.5 * spacing);
  const tolerance = 0.5 * spacing;

  const segments: [Point2, Point2][] = design.flatMap((path) => path.map((a, i) => [a, path[(i + 1) % path.length]] as [Point2, Point2]));
  const clearAt = memo((p: Point2) => segments.every(([a, b]) => distanceToSegment(p, a, b) >= clearance));
  const vertexClear = domain.map(() => undefined as boolean | undefined);
  const isClear = (v: number) => (vertexClear[v] ??= clearAt(domain[v]));
  const edgeClear = (a: number, b: number) =>
    clearAt({ x: (domain[a].x + domain[b].x) / 2, y: (domain[a].y + domain[b].y) / 2 });

  const center = centroid(outline);
  const nearest = (p: Point2) =>
    domain.reduce((best, q, i) => (dist(q, p) < dist(domain[best], p) ? i : best), 0);
  const blocked = new Set<number>();

  /** Walk mesh edges from vertex `start` along `dir` until the mesh boundary, staying close to the ray. */
  const walkOut = (start: number, origin: Point2, dir: Point2): number[] => {
    const path = [start];
    let v = start;
    const along = (p: Point2) => (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
    const off = (p: Point2) => Math.abs((p.x - origin.x) * dir.y - (p.y - origin.y) * dir.x);
    while (!boundary[v]) {
      let best = -1, bestCost = Infinity;
      for (const w of neighbors[v]) {
        const progress = along(domain[w]) - along(domain[v]);
        if (progress < 0.25 * spacing) continue;
        const cost = off(domain[w]) - 1e-3 * progress;
        if (cost < bestCost) [best, bestCost] = [w, cost];
      }
      if (best < 0) break;
      path.push(best);
      v = best;
    }
    return path;
  };

  /** The slit along `angle`: its chain (boundary → tip) and how deep it reaches inside the outline. */
  const candidate = (angle: number) => {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const exit = rayExit(center, dir, outline);
    const tipPoint = { x: center.x + dir.x * Math.max(0, exit - depth), y: center.y + dir.y * Math.max(0, exit - depth) };
    const chain = walkOut(nearest(tipPoint), center, dir).reverse();
    // Keep the part that stays clear of the design and of other slits, from the boundary inward.
    let n = 0;
    while (n < chain.length) {
      const v = chain[n];
      if (!isClear(v) || blocked.has(v) || (n > 0 && !edgeClear(chain[n - 1], v))) break;
      n++;
    }
    const kept = chain.slice(0, n);
    const tip = kept[kept.length - 1];
    const reach = tip === undefined ? 0 : exit - ((domain[tip].x - center.x) * dir.x + (domain[tip].y - center.y) * dir.y);
    return { chain: kept, reach };
  };

  const chains: number[][] = [];
  let shortened = 0;
  const step = (2 * Math.PI) / count;
  for (let k = 0; k < count; k++) {
    const nominal = Math.PI / 2 + k * step;
    const exit = rayExit(center, { x: Math.cos(nominal), y: Math.sin(nominal) }, outline);
    const turn = Math.min(MAX_SHIFT * step, spacing / (2 * Math.max(exit, spacing)));
    const turns = Math.floor((MAX_SHIFT * step) / turn);
    let best = { chain: [] as number[], reach: 0 };
    for (let i = 0; i <= 2 * turns; i++) {
      const offset = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * turn;
      const option = candidate(nominal + offset);
      if (option.chain.length >= 2 && option.reach > best.reach) best = option;
      if (best.reach >= depth - tolerance) break;
    }
    if (best.reach < depth - tolerance) shortened++;
    if (best.chain.length < 2 || best.reach < spacing) continue;
    chains.push(best.chain);
    for (const v of best.chain) {
      blocked.add(v);
      for (const w of neighbors[v]) blocked.add(w);
    }
  }
  return { chains, shortened };
}

function medianEdge({ domain, triangles }: TriangleMesh): number {
  const lengths = triangles.map(([a, b]) => dist(domain[a], domain[b])).sort((x, y) => x - y);
  return lengths[Math.floor(lengths.length / 2)] ?? 1;
}

function centroid(points: Point2[]): Point2 {
  const n = points.length;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

function memo(f: (p: Point2) => boolean): (p: Point2) => boolean {
  const cache = new Map<string, boolean>();
  return (p) => {
    const key = `${p.x},${p.y}`;
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = f(p)));
    return v;
  };
}
