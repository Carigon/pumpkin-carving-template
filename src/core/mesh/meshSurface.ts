import type { Surface, SurfaceHit, Vec3 } from "../surface/surface";
import { buildBvh } from "./bvh";
import type { ProjectionMesh } from "./projectionMesh";

/**
 * The mesh as the surface projection works against: rays along the view hit its triangles (through a BVH), with
 * the vertex normals and coordinates blended across the triangle that is hit.
 *
 * Points by coordinates still come from `source`, the smooth surface the mesh was built from, until flattening
 * moves onto the mesh.
 */
export function meshSurface(mesh: ProjectionMesh, source: Surface): Surface {
  const bvh = buildBvh(mesh);
  const { positions, normals, coords, triangles } = mesh;
  let front = -Infinity;
  for (let i = 2; i < positions.length; i += 3) front = Math.max(front, positions[i]);
  // Start the rays just in front of the mesh, so they don't run long distances in floating point.
  const startZ = front + 1;

  return {
    coordRange: source.coordRange,
    sample: (c) => source.sample(c),
    hitAlongView(x: number, y: number): SurfaceHit | null {
      const hit = bvh.raycast([x, y, startZ], [0, 0, -1]);
      if (!hit) return null;
      const corners = [0, 1, 2].map((c) => triangles[3 * hit.triangle + c]);
      const blend = (data: Float64Array, stride: number, k: number) =>
        corners.reduce((sum, v, c) => sum + hit.weights[c] * data[stride * v + k], 0);
      const n: Vec3 = [blend(normals, 3, 0), blend(normals, 3, 1), blend(normals, 3, 2)];
      const length = Math.hypot(...n) || 1;
      return {
        point: [x, y, startZ - hit.t],
        normal: [n[0] / length, n[1] / length, n[2] / length],
        coords: { u: blend(coords, 2, 0), v: blend(coords, 2, 1) },
      };
    },
  };
}
