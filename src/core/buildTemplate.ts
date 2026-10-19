import { flattenDesign } from "./flatten/flattenDesign";
import { stretchMap } from "./flatten/stretch";
import { clipToConvex } from "./geometry/polygon";
import { designWarnings } from "./projection/designWarnings";
import { placeDesign } from "./projection/placement";
import { projectDesign } from "./projection/projectDesign";
import { frontProjection } from "./projection/projection";
import { ellipsoidSurface } from "./surface/ellipsoid";
import { fitEllipsoid } from "./surface/fitEllipsoid";
import { cutOutline } from "./template/cutOutline";
import { planSlits } from "./template/slits";
import type { FlatTemplate, Point2, SlitOptions, TemplateInput, TemplateResult, TemplateWarning, Units } from "./types";

/** Paper margin between the design and the cut-out edge. */
const CUT_MARGIN_IN = 0.75;
/** Least blank paper between a slit and the design. */
const SLIT_CLEARANCE_IN = 0.1;
const DEFAULT_SLIT_COUNT = 8;
const DEFAULT_SLIT_DEPTH_IN = 2;
const PER_INCH: Record<Units, number> = { in: 1, cm: 2.54 };

/** The slits a template gets unless the carver changes them. */
export function defaultSlits(units: Units): SlitOptions {
  return { count: DEFAULT_SLIT_COUNT, depth: DEFAULT_SLIT_DEPTH_IN * PER_INCH[units] };
}

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
  const slitOptions = input.slits ?? defaultSlits(units);
  let shortened = 0;
  // Mesh a little past the cut-out edge so the edge and the slits sit inside the mesh.
  const flat = flattenDesign(shape, projection, { x: 0, y: placement.verticalOffset }, placed, 1.5 * margin, (mesh, paths) => {
    const plan = planSlits(mesh, paths, cutOutline(paths, margin), {
      count: Math.max(0, Math.round(slitOptions.count)),
      depth: slitOptions.depth,
      clearance: SLIT_CLEARANCE_IN * PER_INCH[units],
    });
    shortened = plan.shortened;
    return plan.chains;
  });

  let template: FlatTemplate | null = null;
  if (flat && flat.paths.length > 0) {
    const outline = cutOutline(flat.paths, margin);
    const slits = flat.slits.map((slit) => longest(clipToConvex(slit, outline))).filter((s): s is Point2[] => s !== null);
    template = { units, designPaths: flat.paths, cutOutline: outline, slits, stretch: stretchMap(flat.mesh, flat.flat) };
  }

  const warnings: TemplateWarning[] = designWarnings(design);
  if (template && shortened > 0) {
    warnings.push({
      kind: "slit-shortened",
      count: shortened,
      message:
        shortened === 1
          ? "One slit would cross the design, so it was made shorter. Try fewer or shallower slits, or a smaller design."
          : `${shortened} slits would cross the design, so they were made shorter. Try fewer or shallower slits, or a smaller design.`,
    });
  }
  return { surface, design, template, warnings };
}

function longest(pieces: Point2[][]): Point2[] | null {
  const length = (line: Point2[]) => line.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - line[i].x, p.y - line[i].y), 0);
  return pieces.reduce<Point2[] | null>((best, p) => (best && length(best) >= length(p) ? best : p), null);
}
