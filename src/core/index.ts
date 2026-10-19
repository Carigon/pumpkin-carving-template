// Public API of the core. Tests go through `buildTemplate` only.
export { buildTemplate, defaultMargin, defaultSlits } from "./buildTemplate";
// Filling in a new ring from the current fit, for the measurement form.
export { nextRing } from "./rings";
export type * from "./types";
// Surface model, for layers that render it (e.g. the 3D preview).
export { ellipsoidSurface } from "./surface/ellipsoid";
export type { Surface, SurfaceCoords, SurfaceSample, SurfaceHit, Vec3 } from "./surface/surface";
// Length units, shared with the layers around the core.
export { convertLength } from "./units";
