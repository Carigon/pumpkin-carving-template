// Public API of the core. Tests go through `buildTemplate` only.
export { buildTemplate, defaultSlits } from "./buildTemplate";
export type * from "./types";
// Surface model, for layers that render it (e.g. the 3D preview).
export { ellipsoidSurface } from "./surface/ellipsoid";
export type { Surface, SurfaceCoords, SurfaceSample, SurfaceHit, Vec3 } from "./surface/surface";
