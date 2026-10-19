import { flattenDesign } from "./flatten/flattenDesign";
import { stretchMap } from "./flatten/stretch";
import { designWarnings } from "./projection/designWarnings";
import { placeDesign } from "./projection/placement";
import { projectDesign } from "./projection/projectDesign";
import { frontProjection } from "./projection/projection";
import { fitSurface } from "./surface/fitSurface";
import { fromInches } from "./units";
import type { FlatTemplate, SlitOptions, TemplateInput, TemplateResult, TemplateWarning, Units } from "./types";

/** Paper margin between the design and the cut-out edge, unless the carver changes it. */
const DEFAULT_CUT_MARGIN_IN = 0.75;
/** Least blank paper between a slit and the design. */
const SLIT_CLEARANCE_IN = 0.1;
const DEFAULT_SLIT_COUNT = 8;
/** Deeper than the margin, so slits reach in between parts of the design where there is room. */
const DEFAULT_SLIT_DEPTH_IN = 1;

/** The paper margin between the design and the cut-out edge a template gets unless the carver changes it. */
export function defaultMargin(units: Units): number {
  return fromInches(DEFAULT_CUT_MARGIN_IN, units);
}

/** The slits a template gets unless the carver changes them. */
export function defaultSlits(units: Units): SlitOptions {
  return { count: DEFAULT_SLIT_COUNT, depth: fromInches(DEFAULT_SLIT_DEPTH_IN, units) };
}

/**
 * The template builder: the single pure entry point of the core.
 * No DOM, canvas, WebGL or PDF dependencies.
 */
export function buildTemplate(input: TemplateInput): TemplateResult {
  const { units } = input.measurements;
  const fit = fitSurface(input.measurements);
  if (!fit.ok) return { surface: null, design: null, template: null, warnings: fit.warnings };
  const { surface, parameters: surfaceParameters } = fit;

  const { design, placement } = input;
  if (!design || !placement || !(placement.width > 0)) {
    return { surface: surfaceParameters, design: null, template: null, warnings: [] };
  }

  const projection = frontProjection(surface);
  const frontViewPaths = placeDesign(design, placement);
  const projected = projectDesign(frontViewPaths, projection);

  const margin = input.margin !== undefined && input.margin > 0 ? input.margin : defaultMargin(units);
  const slitOptions = input.slits ?? defaultSlits(units);
  const flat = flattenDesign({
    surface,
    projection,
    center: { x: 0, y: placement.verticalOffset },
    paths: frontViewPaths,
    margin,
    slits: {
      count: Math.max(0, Math.round(slitOptions.count)),
      depth: slitOptions.depth,
      clearance: fromInches(SLIT_CLEARANCE_IN, units),
    },
  });

  let template: FlatTemplate | null = null;
  if (flat && flat.paths.length > 0) {
    template = {
      units,
      designPaths: flat.paths,
      cutOutline: flat.outline,
      slits: flat.slits,
      stretch: stretchMap(flat.mesh, flat.flat, flat.normals),
    };
  }

  const warnings: TemplateWarning[] = designWarnings(projected);
  const blocked = flat?.blockedSlits ?? 0;
  if (template && blocked > 0) {
    warnings.push({
      kind: "slit-shortened",
      count: blocked,
      message:
        blocked === 1
          ? "One slit ran into the design well before its set depth, so it was cut short. Try fewer or shallower slits."
          : `${blocked} slits ran into the design well before their set depth, so they were cut short. Try fewer or shallower slits.`,
    });
  }
  return { surface: surfaceParameters, design: projected, template, warnings };
}
