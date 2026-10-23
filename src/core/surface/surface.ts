/**
 * Coordinate frame (shared by all surfaces):
 * - x: side-to-side (viewer's right is +x)
 * - y: vertical (stem is +y)
 * - z: viewing axis; the viewer sits far out on +z looking toward -z, so the front of the pumpkin faces +z.
 * Origin is the pumpkin's center.
 */
export type Vec3 = readonly [number, number, number];

/** 2D coordinates on the surface. Their meaning is up to each surface implementation. */
export interface SurfaceCoords {
  u: number;
  v: number;
}

export interface SurfaceSample {
  point: Vec3;
  /** Outward unit normal: the direction the surface faces at `point`. */
  normal: Vec3;
}

/**
 * A smooth surface by coordinates, as meshes are built from (e.g. the revolved profile). Projection and
 * flattening work against the mesh (`MeshSurface`) instead, so new shapes only change the mesh.
 */
export interface Surface {
  /** 3D point and normal at the given surface coordinates. */
  sample(coords: SurfaceCoords): SurfaceSample;
}
