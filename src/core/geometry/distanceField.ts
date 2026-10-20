import type { Point2 } from "../types";
import { distanceToSegment } from "./polygon";

/**
 * A regular grid of sample nodes over a rectangle: node (i, j) sits at (x0 + i·h, y0 + j·h).
 * Values on the grid are stored row by row (index j·nx + i).
 */
export interface Grid {
  x0: number;
  y0: number;
  h: number;
  nx: number;
  ny: number;
}

/** A grid covering `points` plus `pad` on every side, about `cells` nodes across its longer side. */
export function gridAround(points: Point2[], pad: number, cells: number): Grid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const h = (Math.max(maxX - minX, maxY - minY) + 2 * pad) / cells || 1;
  const x0 = minX - pad - h, y0 = minY - pad - h;
  // The longer side spans exactly `cells` steps, so its count must not hang on how that division rounds
  // (one node more or less would move every node-count-dependent result).
  const steps = (span: number) => Math.ceil(span / h - 1e-9);
  return { x0, y0, h, nx: steps(maxX - minX + 2 * pad) + 3, ny: steps(maxY - minY + 2 * pad) + 3 };
}

/**
 * Exact distance from every node to the nearest segment of the closed `paths`, for nodes within `band`
 * of them; nodes farther away get `band`.
 */
export function distanceToPaths(grid: Grid, paths: Point2[][], band: number): Float64Array {
  const { x0, y0, h, nx, ny } = grid;
  const out = new Float64Array(nx * ny).fill(band);
  for (const path of paths) {
    for (let s = 0; s < path.length; s++) {
      const a = path[s], b = path[(s + 1) % path.length];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - band - x0) / h));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + band - x0) / h));
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - band - y0) / h));
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + band - y0) / h));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          const d = distanceToSegment({ x: x0 + i * h, y: y0 + j * h }, a, b);
          if (d < out[k]) out[k] = d;
        }
      }
    }
  }
  return out;
}

/**
 * Euclidean distance (in grid units of length, i.e. already times h) from every node to the nearest
 * source node (Felzenszwalb–Huttenlocher). Nodes when there are no sources get a huge value.
 */
export function distanceToNodes(grid: Grid, isSource: (k: number) => boolean): Float64Array {
  const { nx, ny, h } = grid;
  const INF = 1e20;
  const f = new Float64Array(nx * ny);
  for (let k = 0; k < f.length; k++) f[k] = isSource(k) ? 0 : INF;
  const n = Math.max(nx, ny);
  const line = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (count: number, get: (q: number) => number, set: (q: number, value: number) => void) => {
    for (let q = 0; q < count; q++) line[q] = get(q);
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < count; q++) {
      let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < count; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + line[v[k]];
    }
    for (let q = 0; q < count; q++) set(q, out[q]);
  };
  for (let j = 0; j < ny; j++) pass(nx, (i) => f[j * nx + i], (i, x) => (f[j * nx + i] = x));
  for (let i = 0; i < nx; i++) pass(ny, (j) => f[j * nx + i], (j, x) => (f[j * nx + i] = x));
  for (let k = 0; k < f.length; k++) f[k] = Math.sqrt(f[k]) * h;
  return f;
}

/** Bilinear interpolation of node values at `p`, clamped to the grid. */
export function sampleGrid(grid: Grid, values: ArrayLike<number>, p: Point2): number {
  const { x0, y0, h, nx, ny } = grid;
  const fx = Math.min(nx - 1.000001, Math.max(0, (p.x - x0) / h));
  const fy = Math.min(ny - 1.000001, Math.max(0, (p.y - y0) / h));
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const k = j * nx + i;
  return (
    (1 - ty) * ((1 - tx) * values[k] + tx * values[k + 1]) + ty * ((1 - tx) * values[k + nx] + tx * values[k + nx + 1])
  );
}

/**
 * Inside nodes (value ≤ 0) that can't be reached from the grid's border without crossing inside nodes
 * are holes; give them `fill` so the region has no holes.
 */
export function fillHoles(grid: Grid, values: Float64Array, fill: number): void {
  const { nx, ny } = grid;
  const outside = new Uint8Array(nx * ny);
  const stack: number[] = [];
  const push = (k: number) => {
    if (!outside[k] && values[k] > 0) {
      outside[k] = 1;
      stack.push(k);
    }
  };
  for (let i = 0; i < nx; i++) { push(i); push((ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { push(j * nx); push(j * nx + nx - 1); }
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % nx, j = (k - i) / nx;
    if (i > 0) push(k - 1);
    if (i < nx - 1) push(k + 1);
    if (j > 0) push(k - nx);
    if (j < ny - 1) push(k + nx);
  }
  for (let k = 0; k < values.length; k++) if (!outside[k] && values[k] > 0) values[k] = fill;
}

/**
 * The boundary loops of the region where `values` ≤ 0 (marching squares, linear interpolation along cell
 * edges). Nodes on the grid's border must be outside (> 0) so every loop closes.
 * Every loop is returned counterclockwise (callers here fill holes first, so loops are outer boundaries).
 */
export function contourLoops(grid: Grid, values: Float64Array): Point2[][] {
  const { x0, y0, h, nx, ny } = grid;
  const inside = (k: number) => values[k] <= 0;
  // Crossing point on an edge, by id: 2k = edge from node k to k+1 (horizontal), 2k+1 = from k to k+nx.
  const crossing = (id: number): Point2 => {
    const k = id >> 1, other = id & 1 ? k + nx : k + 1;
    const a = values[k], b = values[other];
    const t = a === b ? 0.5 : a / (a - b);
    const i = k % nx, j = (k - i) / nx;
    return id & 1 ? { x: x0 + i * h, y: y0 + (j + t) * h } : { x: x0 + (i + t) * h, y: y0 + j * h };
  };
  const ends = new Map<number, number[]>(); // edge id → segment ids touching it
  const segments: [number, number][] = [];
  const add = (e1: number, e2: number) => {
    const s = segments.length;
    segments.push([e1, e2]);
    for (const e of [e1, e2]) {
      const list = ends.get(e);
      if (list) list.push(s);
      else ends.set(e, [s]);
    }
  };
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      const ia = inside(a), ib = inside(b), ic = inside(c), id = inside(d);
      // Cell edges counterclockwise: bottom (a-b), right (b-c), top (d-c), left (a-d).
      const bottom = 2 * a, right = 2 * b + 1, top = 2 * d, left = 2 * a + 1;
      const cut = [ia !== ib, ib !== ic, ic !== id, id !== ia];
      const edges = [bottom, right, top, left].filter((_, n) => cut[n]);
      if (edges.length === 2) add(edges[0], edges[1]);
      else if (edges.length === 4) {
        const centerInside = values[a] + values[b] + values[c] + values[d] <= 0;
        // Saddle: pair the crossings so the inside corners connect through the center or not.
        if (ia === centerInside) {
          add(bottom, right);
          add(top, left);
        } else {
          add(left, bottom);
          add(right, top);
        }
      }
    }
  }

  const used = new Uint8Array(segments.length);
  const loops: Point2[][] = [];
  for (let s0 = 0; s0 < segments.length; s0++) {
    if (used[s0]) continue;
    const loop: Point2[] = [];
    let s = s0, edge = segments[s0][0];
    while (!used[s]) {
      used[s] = 1;
      loop.push(crossing(edge));
      const [e1, e2] = segments[s];
      edge = e1 === edge ? e2 : e1;
      const next = (ends.get(edge) ?? []).find((t) => !used[t]);
      if (next === undefined) break;
      s = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops.map((loop) => (signedArea(loop) >= 0 ? loop : loop.reverse()));
}

/** Shoelace area: positive for counterclockwise polygons. */
export function signedArea(polygon: Point2[]): number {
  let s = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
