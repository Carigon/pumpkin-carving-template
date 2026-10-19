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

export interface SurfaceHit extends SurfaceSample {
  coords: SurfaceCoords;
}

/**
 * A smooth surface by coordinates, as meshes are built from (e.g. the revolved profile). Projection and
 * flattening work against the mesh (`MeshSurface`) instead, so new shapes only change the mesh.
 */
export interface Surface {
  /**
   * The coordinate range `sample` covers. The edges may be singular (poles) or a seam; meshes stay a little
   * inside it.
   */
  coordRange: { minU: number; maxU: number; minV: number; maxV: number };
  /** 3D point and normal at the given surface coordinates. */
  sample(coords: SurfaceCoords): SurfaceSample;
  /**
   * First hit of a ray travelling along the viewing axis (-z) through (x, y),
   * i.e. the front-most surface point seen at that spot. Null if the ray misses the silhouette.
   */
  hitAlongView(x: number, y: number): SurfaceHit | null;
}
