import type { SurfaceMesh } from "../types";

/**
 * The surface mesh projection works against: per vertex also the surface coordinates (u, v) it came from, blended
 * across the triangle a ray hits. (Not the flattening mesh in `flatten/mesh.ts`.)
 */
export interface ProjectionMesh extends SurfaceMesh {
  /** Surface coordinates (u, v) per vertex. */
  coords: Float64Array;
}
