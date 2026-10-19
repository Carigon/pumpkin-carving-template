import type { SurfaceSample, Vec3 } from "../surface/surface";
import type { SurfaceMesh } from "../types";
import { buildBvh } from "./bvh";

/** Where a point sits on a mesh: its triangle and the weights of the triangle's corners (they sum to 1). */
export interface MeshLocation {
  triangle: number;
  weights: [number, number, number];
}

/** Where a ray meets the mesh: the point, the blended normal, and the triangle and its corners' weights there. */
export interface MeshHit extends SurfaceSample, MeshLocation {}

/** The mesh as the surface projection and flattening work against. */
export interface MeshSurface {
  mesh: SurfaceMesh;
  /**
   * First hit of a ray travelling along the viewing axis (-z) through (x, y), i.e. the front-most surface point
   * seen at that spot. Null if the ray misses the silhouette.
   */
  hitAlongView(x: number, y: number): MeshHit | null;
}

/**
 * Rays along the view hit the mesh's triangles (through a BVH), with the vertex normals blended across the
 * triangle that is hit.
 */
export function meshSurface(mesh: SurfaceMesh): MeshSurface {
  const bvh = buildBvh(mesh);
  const { positions, normals, triangles } = mesh;
  let front = -Infinity;
  for (let i = 2; i < positions.length; i += 3) front = Math.max(front, positions[i]);
  // Start the rays just in front of the mesh, so they don't run long distances in floating point.
  const startZ = front + 1;

  return {
    mesh,
    hitAlongView(x: number, y: number): MeshHit | null {
      const hit = bvh.raycast([x, y, startZ], [0, 0, -1]);
      if (!hit) return null;
      const corners = [0, 1, 2].map((c) => triangles[3 * hit.triangle + c]);
      const blend = (k: number) => corners.reduce((sum, v, c) => sum + hit.weights[c] * normals[3 * v + k], 0);
      const n: Vec3 = [blend(0), blend(1), blend(2)];
      const length = Math.hypot(...n) || 1;
      return {
        point: [x, y, startZ - hit.t],
        normal: [n[0] / length, n[1] / length, n[2] / length],
        triangle: hit.triangle,
        weights: hit.weights,
      };
    },
  };
}
