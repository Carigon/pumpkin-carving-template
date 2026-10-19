import { add3, dot3, length3, normalize3, scale3, sub3 } from "../geometry/vector";
import type { MeshLocation } from "../mesh/meshSurface";
import type { Vec3 } from "../surface/surface";
import type { SurfaceMesh } from "../types";
import type { TriangleMesh } from "./mesh";

/**
 * The surface mesh as one connected sheet: vertices at the same place (a seam, a pole drawn as one vertex per
 * column) are joined, so paper can be laid across them. Triangles keep their indices.
 */
export function weldMesh({ positions, normals, triangles }: SurfaceMesh): TriangleMesh {
  let size = 0;
  for (const x of positions) size = Math.max(size, Math.abs(x));
  const grain = 1e-9 * (size || 1);
  const key = (i: number) => [0, 1, 2].map((k) => Math.round(positions[3 * i + k] / grain)).join(",");
  const seen = new Map<string, number>();
  const vertices: Vec3[] = [];
  const welded: Vec3[] = [];
  const index = Array.from({ length: positions.length / 3 }, (_, i) => {
    const k = key(i);
    let v = seen.get(k);
    if (v === undefined) {
      v = vertices.length;
      seen.set(k, v);
      vertices.push([positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]]);
      welded.push([normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]]);
    }
    return v;
  });
  const tris: [number, number, number][] = [];
  for (let t = 0; t < triangles.length; t += 3) tris.push([index[triangles[t]], index[triangles[t + 1]], index[triangles[t + 2]]]);
  return { vertices, normals: welded, triangles: tris };
}

/**
 * The triangles reachable from `start` across shared edges through triangles `keep` accepts (`start` itself
 * always counts). Growing outward from the design keeps far-away parts of the surface out of the patch.
 */
export function growPatch(mesh: TriangleMesh, start: number, keep: (triangle: number) => boolean): number[] {
  const incident: number[][] = mesh.vertices.map(() => []);
  mesh.triangles.forEach((tri, t) => tri.forEach((v) => incident[v].push(t)));
  const visited = new Uint8Array(mesh.triangles.length);
  visited[start] = 1;
  const patch = [start];
  for (let i = 0; i < patch.length; i++) {
    const [a, b, c] = mesh.triangles[patch[i]];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      for (const t of incident[p]) {
        if (visited[t] || !mesh.triangles[t].includes(q)) continue;
        visited[t] = 1;
        if (keep(t)) patch.push(t);
      }
    }
  }
  return patch;
}

/** Longest edge of the triangles, in 3D. */
export function longestEdge(mesh: TriangleMesh, triangles: number[]): number {
  let longest = 0;
  for (const t of triangles) {
    const [a, b, c] = mesh.triangles[t].map((v) => mesh.vertices[v]);
    longest = Math.max(longest, length3(sub3(a, b)), length3(sub3(b, c)), length3(sub3(c, a)));
  }
  return longest;
}

/** Triangles of the mesh split into finer ones, and where points of the original triangles land among them. */
export interface RefinedPatch {
  mesh: TriangleMesh;
  /** The fine triangle and weights at a location on one of the refined triangles of the original mesh. */
  locate(at: MeshLocation): MeshLocation | null;
}

/**
 * Split each of `triangles` into `n`² smaller ones, n along each edge. New vertices lie on the curved triangle
 * that meets the corners square to their normals (see `curvedPoint`), within the mesh tolerance of the facets,
 * so the curvature is spread across each facet as its blended normals shade it, rather than bunched at its corners.
 * Normals are blended across the facet. Neighbouring triangles share the vertices along their common edge, so the
 * refined patch stays one connected sheet.
 */
export function refinePatch(mesh: TriangleMesh, triangles: number[], n: number): RefinedPatch {
  const out: TriangleMesh = { vertices: [], normals: [], triangles: [] };
  const ids = new Map<string, number>();
  /** The vertex at lattice point (i, j) of triangle `tri`: corner 0 + i/n toward corner 1 + j/n toward corner 2. */
  const vertex = (tri: readonly number[], i: number, j: number): number => {
    const weights = [n - i - j, i, j];
    // Name the point by the original vertices it lies between, so neighbours sharing an edge share it.
    const on = [0, 1, 2].filter((c) => weights[c] > 0).sort((c, d) => tri[c] - tri[d]);
    const key = on.length === 3 ? `${tri.join(",")}:${i},${j}` : on.map((c) => `${tri[c]}:${weights[c]}`).join(",");
    let id = ids.get(key);
    if (id === undefined) {
      id = out.vertices.length;
      ids.set(key, id);
      const w = weights.map((x) => x / n) as [number, number, number];
      const corners = tri.map((v) => mesh.vertices[v]);
      const normals = tri.map((v) => mesh.normals[v]);
      out.vertices.push(curvedPoint(corners, normals, w));
      out.normals.push(normalize3(add3(scale3(normals[0], w[0]), scale3(normals[1], w[1]), scale3(normals[2], w[2]))));
    }
    return id;
  };

  // Per original triangle, its first fine triangle: then up triangles (i, j) and down triangles (i, j) follow
  // in lattice order.
  const first = new Map<number, number>();
  for (const t of triangles) {
    const tri = mesh.triangles[t];
    first.set(t, out.triangles.length);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i + j < n; i++) {
        out.triangles.push([vertex(tri, i, j), vertex(tri, i + 1, j), vertex(tri, i, j + 1)]);
        if (i + j < n - 1) out.triangles.push([vertex(tri, i + 1, j), vertex(tri, i + 1, j + 1), vertex(tri, i, j + 1)]);
      }
    }
  }
  /** Index among a triangle's fine triangles of up triangle (i, j); its down triangle comes right after it. */
  const rowStart = (j: number) => j * (2 * n - j);
  const up = (i: number, j: number) => rowStart(j) + 2 * i;

  return {
    mesh: out,
    locate({ triangle, weights: [, w1, w2] }) {
      const base = first.get(triangle);
      if (base === undefined) return null;
      const a = Math.max(0, w1 * n), b = Math.max(0, w2 * n);
      const i = Math.min(Math.floor(a), n - 1);
      const j = Math.min(Math.floor(b), n - 1 - i);
      const fa = a - i, fb = b - j;
      if (fa + fb <= 1 || i + j === n - 1) return { triangle: base + up(i, j), weights: [1 - fa - fb, fa, fb] };
      return { triangle: base + up(i, j) + 1, weights: [1 - fb, fa + fb - 1, 1 - fa] };
    },
  };
}

/**
 * The point at weights `w` on the curved triangle through the corners that meets each corner square to its normal
 * (a point-normal triangle, Vlachos et al. 2001). Along an edge it depends only on that edge's two corners, so
 * neighbouring triangles meet without gaps.
 */
function curvedPoint(p: Vec3[], n: Vec3[], w: readonly [number, number, number]): Vec3 {
  /** Control point a third of the way from corner i toward corner j, pulled into the tangent plane at i. */
  const toward = (i: number, j: number) => scale3(sub3(add3(scale3(p[i], 2), p[j]), scale3(n[i], dot3(sub3(p[j], p[i]), n[i]))), 1 / 3);
  const edges = [toward(0, 1), toward(1, 0), toward(1, 2), toward(2, 1), toward(2, 0), toward(0, 2)];
  const e = scale3(add3(...edges), 1 / 6);
  const middle = add3(e, scale3(sub3(e, scale3(add3(...p), 1 / 3)), 1 / 2));
  const [a, b, c] = w;
  return add3(
    scale3(p[0], a * a * a), scale3(p[1], b * b * b), scale3(p[2], c * c * c),
    scale3(edges[0], 3 * a * a * b), scale3(edges[1], 3 * a * b * b),
    scale3(edges[2], 3 * b * b * c), scale3(edges[3], 3 * b * c * c),
    scale3(edges[4], 3 * c * c * a), scale3(edges[5], 3 * c * a * a),
    scale3(middle, 6 * a * b * c),
  );
}
