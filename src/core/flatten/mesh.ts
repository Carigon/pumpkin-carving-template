import type { Point2 } from "../types";
import type { Vec3 } from "../surface/surface";

/**
 * A triangle mesh over part of the surface, with each vertex known both in 3D and in a 2D
 * meshing domain (a locally metric chart of the surface). Generic on purpose: cutting slits
 * duplicates vertices along the cut (same 3D and domain position, separate indices) and
 * re-points the triangles on one side, and everything downstream still works.
 */
export interface TriangleMesh {
  /** 3D positions on the surface. */
  vertices: Vec3[];
  /** The same vertices in the meshing domain. */
  domain: Point2[];
  triangles: [number, number, number][];
}

/** A domain rectangle to cover with a regular grid of triangles. */
export interface GridRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Target triangle leg length in domain units. */
  spacing: number;
}

/**
 * Regular right-triangle grid over `region`, lifted to the surface by `lift`.
 * Diagonals alternate per cell so the mesh has no preferred direction.
 */
export function gridMesh(region: GridRegion, lift: (p: Point2) => Vec3): TriangleMesh {
  const nx = Math.max(1, Math.ceil((region.maxX - region.minX) / region.spacing));
  const ny = Math.max(1, Math.ceil((region.maxY - region.minY) / region.spacing));
  const dx = (region.maxX - region.minX) / nx;
  const dy = (region.maxY - region.minY) / ny;
  const domain: Point2[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) domain.push({ x: region.minX + i * dx, y: region.minY + j * dy });
  }
  const id = (i: number, j: number) => j * (nx + 1) + i;
  const triangles: [number, number, number][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      if ((i + j) % 2 === 0) triangles.push([a, b, c], [a, c, d]);
      else triangles.push([a, b, d], [b, c, d]);
    }
  }
  return { vertices: domain.map(lift), domain, triangles };
}

/** Keep only the triangles `keep` accepts, dropping vertices no triangle uses. */
export function trimMesh(mesh: TriangleMesh, keep: (triangle: [number, number, number]) => boolean): TriangleMesh {
  const remap = new Int32Array(mesh.vertices.length).fill(-1);
  const out: TriangleMesh = { vertices: [], domain: [], triangles: [] };
  for (const tri of mesh.triangles) {
    if (!keep(tri)) continue;
    out.triangles.push(
      tri.map((i) => {
        if (remap[i] < 0) {
          remap[i] = out.vertices.length;
          out.vertices.push(mesh.vertices[i]);
          out.domain.push(mesh.domain[i]);
        }
        return remap[i];
      }) as [number, number, number],
    );
  }
  return out;
}

/** Where a domain point sits in the mesh: its triangle and barycentric weights. */
export interface MeshLocation {
  triangle: number;
  weights: [number, number, number];
}

/** Point location in the meshing domain, via a bucket grid over triangle bounding boxes. */
export function meshLocator(mesh: TriangleMesh): (p: Point2) => MeshLocation | null {
  const { domain, triangles } = mesh;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of domain) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const n = Math.max(1, Math.ceil(Math.sqrt(triangles.length / 2)));
  const cw = (maxX - minX) / n || 1;
  const ch = (maxY - minY) / n || 1;
  const cell = (v: number, lo: number, size: number) => Math.min(n - 1, Math.max(0, Math.floor((v - lo) / size)));
  const buckets: number[][] = Array.from({ length: n * n }, () => []);
  triangles.forEach((tri, t) => {
    const xs = tri.map((i) => domain[i].x);
    const ys = tri.map((i) => domain[i].y);
    const i0 = cell(Math.min(...xs), minX, cw), i1 = cell(Math.max(...xs), minX, cw);
    const j0 = cell(Math.min(...ys), minY, ch), j1 = cell(Math.max(...ys), minY, ch);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * n + i].push(t);
  });

  const EPS = 1e-9;
  return (p) => {
    if (p.x < minX - EPS || p.x > maxX + EPS || p.y < minY - EPS || p.y > maxY + EPS) return null;
    for (const t of buckets[cell(p.y, minY, ch) * n + cell(p.x, minX, cw)]) {
      const [a, b, c] = triangles[t].map((i) => domain[i]);
      const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      const w1 = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
      const w2 = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
      const w0 = 1 - w1 - w2;
      if (w0 >= -EPS && w1 >= -EPS && w2 >= -EPS) return { triangle: t, weights: [w0, w1, w2] };
    }
    return null;
  };
}

/** A mesh with slits cut in, and for each slit the vertex on the far side of the cut. */
export interface SlitMesh {
  mesh: TriangleMesh;
  /**
   * Per slit, per vertex of its chain: the vertex index on the other side of the cut
   * (the chain itself keeps the original indices). The tip is shared, so it maps to itself.
   */
  otherSide: number[][];
}

/**
 * Cut slits along chains of mesh edges. Each chain runs from the mesh boundary to the slit's tip,
 * through edge-adjacent vertices; chains must not share vertices. Every chain vertex but the tip is
 * duplicated and the triangles on the left of the chain (counterclockwise domain order) move to the copy.
 * A chain that doesn't start on the boundary still splits along its length but stays closed at its start.
 */
export function cutSlits(mesh: TriangleMesh, chains: number[][]): SlitMesh {
  const out: TriangleMesh = {
    vertices: [...mesh.vertices],
    domain: [...mesh.domain],
    triangles: mesh.triangles.map((t) => [...t] as [number, number, number]),
  };
  const incident: number[][] = mesh.vertices.map(() => []);
  mesh.triangles.forEach((tri, t) => tri.forEach((v) => incident[v].push(t)));

  const otherSide = chains.map((chain) => {
    const cut = new Set<string>();
    for (let i = 0; i + 1 < chain.length; i++) cut.add(edgeKey(chain[i], chain[i + 1]));
    return chain.map((v, i) => {
      if (i === chain.length - 1) return v;
      const next = chain[i + 1];
      const fan = incident[v];
      // Group the fan into sides: triangles sharing an uncut edge through v are on the same side.
      const group = fan.map((_, k) => k);
      const find = (k: number): number => (group[k] === k ? k : (group[k] = find(group[k])));
      for (let a = 0; a < fan.length; a++) {
        for (let b = a + 1; b < fan.length; b++) {
          const shared = mesh.triangles[fan[a]].filter((w) => w !== v && mesh.triangles[fan[b]].includes(w));
          if (shared.some((w) => !cut.has(edgeKey(v, w)))) group[find(a)] = find(b);
        }
      }
      const left = fan.findIndex((t) => hasDirectedEdge(mesh.triangles[t], v, next));
      if (left < 0) return v;
      const side = find(left);
      if (fan.every((_, k) => find(k) === side)) return v;
      const copy = out.vertices.length;
      out.vertices.push(mesh.vertices[v]);
      out.domain.push(mesh.domain[v]);
      fan.forEach((t, k) => {
        if (find(k) !== side) return;
        const tri = out.triangles[t];
        tri[tri.indexOf(v)] = copy;
      });
      return copy;
    });
  });
  return { mesh: out, otherSide };
}

/** Each vertex's edge-neighbors, and which vertices lie on the mesh boundary. */
export function meshTopology(mesh: TriangleMesh): { neighbors: number[][]; boundary: boolean[] } {
  const neighbors: Set<number>[] = mesh.vertices.map(() => new Set());
  const edgeCount = new Map<string, number>();
  for (const tri of mesh.triangles) {
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      neighbors[a].add(b);
      neighbors[b].add(a);
      const key = edgeKey(a, b);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  const boundary = mesh.vertices.map(() => false);
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    for (const v of key.split(",")) boundary[Number(v)] = true;
  }
  return { neighbors: neighbors.map((s) => [...s]), boundary };
}

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const hasDirectedEdge = (tri: readonly number[], a: number, b: number) =>
  tri.some((v, k) => v === a && tri[(k + 1) % 3] === b);
