import { designWarnings } from "./projection/designWarnings";
import { placeDesign } from "./projection/placement";
import { projectDesign } from "./projection/projectDesign";
import { frontProjection } from "./projection/projection";
import { ellipsoidSurface } from "./surface/ellipsoid";
import { fitEllipsoid } from "./surface/fitEllipsoid";
import type { TemplateInput, TemplateResult } from "./types";

/**
 * The template builder: the single pure entry point of the core.
 * No DOM, canvas, WebGL or PDF dependencies.
 */
export function buildTemplate(input: TemplateInput): TemplateResult {
  const fit = fitEllipsoid(input.measurements);
  if (!fit.ok) return { surface: null, design: null, warnings: [fit.warning] };
  const surface = { kind: "ellipsoid" as const, semiAxes: fit.semiAxes, units: input.measurements.units };

  const { design: source, placement } = input;
  if (!source || !placement || !(placement.width > 0)) return { surface, design: null, warnings: [] };

  const projection = frontProjection(ellipsoidSurface(fit.semiAxes));
  const design = projectDesign(placeDesign(source, placement), projection);
  return { surface, design, warnings: designWarnings(design) };
}
