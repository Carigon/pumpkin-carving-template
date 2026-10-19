import { flattenDesign } from "./flatten/flattenDesign";
import { designWarnings } from "./projection/designWarnings";
import { placeDesign } from "./projection/placement";
import { projectDesign } from "./projection/projectDesign";
import { frontProjection } from "./projection/projection";
import { ellipsoidSurface } from "./surface/ellipsoid";
import { fitEllipsoid } from "./surface/fitEllipsoid";
import { cutOutline } from "./template/cutOutline";
import type { FlatTemplate, TemplateInput, TemplateResult, Units } from "./types";

/** Paper margin between the design and the cut-out edge. */
const CUT_MARGIN_IN = 0.75;
const PER_INCH: Record<Units, number> = { in: 1, cm: 2.54 };

/**
 * The template builder: the single pure entry point of the core.
 * No DOM, canvas, WebGL or PDF dependencies.
 */
export function buildTemplate(input: TemplateInput): TemplateResult {
  const { units } = input.measurements;
  const fit = fitEllipsoid(input.measurements);
  if (!fit.ok) return { surface: null, design: null, template: null, warnings: [fit.warning] };
  const surface = { kind: "ellipsoid" as const, semiAxes: fit.semiAxes, units };

  const { design: source, placement } = input;
  if (!source || !placement || !(placement.width > 0)) return { surface, design: null, template: null, warnings: [] };

  const shape = ellipsoidSurface(fit.semiAxes);
  const projection = frontProjection(shape);
  const placed = placeDesign(source, placement);
  const design = projectDesign(placed, projection);

  const margin = CUT_MARGIN_IN * PER_INCH[units];
  // Mesh a little past the cut-out edge so the edge (and later the slits) sit inside the mesh.
  const flat = flattenDesign(shape, projection, { x: 0, y: placement.verticalOffset }, placed, 1.5 * margin);
  const template: FlatTemplate | null =
    flat && flat.paths.length > 0
      ? { units, designPaths: flat.paths, cutOutline: cutOutline(flat.paths, margin) }
      : null;

  return { surface, design, template, warnings: designWarnings(design) };
}
