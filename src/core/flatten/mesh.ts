import type { Vec3 } from "../surface/surface";

/**
 * A triangle mesh over part of the surface, with each vertex's 3D position and blended outward normal. Generic on
 * purpose: cutting slits duplicates vertices along the cut (same position and normal, separate indices) and
 * re-points the triangles on one side, and everything downstream still works.
 */
export interface TriangleMesh {
  /** 3D positions on the surface. */
  vertices: Vec3[];
  /** Outward unit normal at each vertex. */
  normals: Vec3[];
  triangles: [number, number, number][];
}

/**
 * Keep only the triangles `keep` accepts, dropping vertices no triangle uses. `newIndex[t]` is the new index of
 * triangle t, or -1 if it was dropped.
 */
export function trimMesh(
  mesh: TriangleMesh,
  keep: (triangle: [number, number, number]) => boolean,
): { mesh: TriangleMesh; newIndex: Int32Array } {
  const remap = new Int32Array(mesh.vertices.length).fill(-1);
  const newIndex = new Int32Array(mesh.triangles.length).fill(-1);
  const out: TriangleMesh = { vertices: [], normals: [], triangles: [] };
  mesh.triangles.forEach((tri, t) => {
    if (!keep(tri)) return;
    newIndex[t] = out.triangles.length;
    out.triangles.push(
      tri.map((i) => {
        if (remap[i] < 0) {
          remap[i] = out.vertices.length;
          out.vertices.push(mesh.vertices[i]);
          out.normals.push(mesh.normals[i]);
        }
        return remap[i];
      }) as [number, number, number],
    );
  });
  return { mesh: out, newIndex };
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
 * duplicated and the triangles on the left of the chain (counterclockwise seen from outside) move to the copy.
 * A chain that doesn't start on the boundary still splits along its length but stays closed at its start.
 */
export function cutSlits(mesh: TriangleMesh, chains: number[][]): SlitMesh {
  const out: TriangleMesh = {
    vertices: [...mesh.vertices],
    normals: [...mesh.normals],
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
      out.normals.push(mesh.normals[v]);
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
