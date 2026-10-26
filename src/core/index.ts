// Public API of the core. Tests go through `buildTemplate` (and the builder that keeps the surface between calls).
export { buildTemplate, createTemplateBuilder, defaultMargin, defaultSlits } from "./buildTemplate";
// The profile alone, quick enough to refit while a ring is dragged.
export { fitProfile } from "./surface/fitSurface";
// The circumference a new ring takes, read off the current fit.
export { ringAt } from "./rings";
export type * from "./types";
// The coordinate frame every 3D point uses, for layers that render the surface (e.g. the 3D preview).
export type { Vec3 } from "./surface/surface";
// Plane geometry the hand-trace editor's hit tests share with the core.
export { distanceToSegment, insidePolygon } from "./geometry/polygon";
export { signedArea } from "./geometry/distanceField";
