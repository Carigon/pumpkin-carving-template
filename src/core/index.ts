// Public API of the core. Tests go through `buildTemplate` (and the builder that keeps the surface between calls).
export { buildTemplate, createTemplateBuilder, defaultMargin, defaultSlits, type TemplateBuilder } from "./buildTemplate";
// The profile alone, quick enough to refit while a ring is dragged.
export { fitProfile } from "./surface/fitSurface";
// Filling in a new ring from the current fit, for the measurement form.
export { nextRing } from "./rings";
export type * from "./types";
// Surface model, for layers that render it (e.g. the 3D preview).
export { ellipsoidSurface } from "./surface/ellipsoid";
export type { Surface, SurfaceCoords, SurfaceSample, SurfaceHit, Vec3 } from "./surface/surface";
