import { fitEllipsoid } from "./surface/fitEllipsoid";
import type { TemplateInput, TemplateResult } from "./types";

/**
 * The template builder: the single pure entry point of the core.
 * No DOM, canvas, WebGL or PDF dependencies.
 */
export function buildTemplate(input: TemplateInput): TemplateResult {
  const fit = fitEllipsoid(input.measurements);
  if (!fit.ok) return { surface: null, warnings: [fit.warning] };
  return {
    surface: { kind: "ellipsoid", semiAxes: fit.semiAxes, units: input.measurements.units },
    warnings: [],
  };
}
