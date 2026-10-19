import type { Point2 } from "../types";
import type { MeshHit, MeshSurface } from "../mesh/meshSurface";

/**
 * Maps a placed front-view point onto the surface. The seam that lets a perspective
 * projection (from a set viewing distance) replace the front-view one later.
 */
export interface Projection {
  /** Surface point seen at `front`, or null when that point misses the pumpkin. */
  project(front: Point2): MeshHit | null;
}

/** Orthographic front view: each point is pushed straight back along the viewing axis (-z). */
export function frontProjection(surface: MeshSurface): Projection {
  return { project: ({ x, y }) => surface.hitAlongView(x, y) };
}
