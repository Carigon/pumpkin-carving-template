import { flattenDesign } from "./flatten/flattenDesign";
import { stretchMap } from "./flatten/stretch";
import { designWarnings } from "./projection/designWarnings";
import { placeDesign } from "./projection/placement";
import { projectDesign } from "./projection/projectDesign";
import { frontProjection } from "./projection/projection";
import { fitSurface, type SurfaceFit } from "./surface/fitSurface";
import type {
  BuildProgress,
  FlatTemplate,
  PumpkinMeasurements,
  SlitOptions,
  TemplateInput,
  TemplateResult,
  TemplateWarning,
} from "./types";

/** Paper margin between the design and the cut-out edge, unless the carver changes it. */
const DEFAULT_CUT_MARGIN_MM = 20;
/** Least blank paper between a slit and the design. */
const SLIT_CLEARANCE_MM = 2.5;
/** Least distance between two slits, so they don't crowd one gap and leave thin strips of paper. */
const SLIT_SPACING_MM = 25;
/**
 * Short stubs on open paper barely relieve any stretch, so slits shorter than this aren't placed, unless the margin
 * is narrower: a slit that runs through most of the margin band (`MIN_MARGIN_SHARE` of the paper between the edge
 * and the design's clearance) still helps a lot on solid designs, where nothing deeper fits.
 */
const MIN_SLIT_DEPTH_MM = 20;
const MIN_MARGIN_SHARE = 0.8;
/** Deeper than the margin, so slits reach in between parts of the design where there is room. */
const DEFAULT_SLIT_DEPTH_MM = 50;

/** The paper margin between the design and the cut-out edge a template gets unless the carver changes it, in mm. */
export function defaultMargin(): number {
  return DEFAULT_CUT_MARGIN_MM;
}

/** The slits a template gets unless the carver changes them (depth in mm). */
export function defaultSlits(): SlitOptions {
  return { count: "auto", depth: DEFAULT_SLIT_DEPTH_MM };
}

/**
 * The template builder: the single pure entry point of the core. Every length in and out is in mm.
 * No DOM, canvas, WebGL or PDF dependencies.
 */
export function buildTemplate(input: TemplateInput): TemplateResult {
  return createTemplateBuilder().build(input);
}

/**
 * A template builder that keeps the fitted surface (mesh and lookup tree) between calls, so it is refitted
 * only when the measurements change, not on placement, design, slit or margin edits.
 */
export interface TemplateBuilder {
  /** The same result as `buildTemplate`. */
  build(input: TemplateInput): TemplateResult;
  /**
   * The same build in steps: it yields progress after each slit is placed and returns the result. Placing slits
   * can take seconds, so a caller can report progress, or drop the build between slits when it's no longer wanted.
   */
  steps(input: TemplateInput): Generator<BuildProgress, TemplateResult>;
  /**
   * The quick part alone: the surface and the design projected onto it, without flattening. `template` is
   * null, and slit warnings (which need the flat template) are left out.
   */
  preview(input: TemplateInput): TemplateResult;
}

export function createTemplateBuilder(): TemplateBuilder {
  let fitted: { key: string; fit: SurfaceFit } | null = null;
  const fitFor = (m: PumpkinMeasurements): SurfaceFit => {
    const key = JSON.stringify(m);
    if (fitted?.key !== key) fitted = { key, fit: fitSurface(m) };
    return fitted.fit;
  };
  const steps = (input: TemplateInput, flatten = true) => buildFromFit(input, fitFor(input.measurements), flatten);
  return {
    build: (input) => finish(steps(input)),
    steps: (input) => steps(input),
    preview: (input) => finish(steps(input, false)),
  };
}

/** Run a build's steps to the end. */
function finish(steps: Generator<BuildProgress, TemplateResult>): TemplateResult {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The template for `input` on an already fitted surface; without `flatten`, only the quick projection. */
function* buildFromFit(input: TemplateInput, fit: SurfaceFit, flatten: boolean): Generator<BuildProgress, TemplateResult> {
  if (!fit.ok) return { surface: null, design: null, template: null, warnings: [...fit.warnings] };
  const { surface, parameters: surfaceParameters } = fit;

  const { design, placement } = input;
  if (!design || !placement || !(placement.width > 0)) {
    return { surface: surfaceParameters, design: null, template: null, warnings: [] };
  }

  const projection = frontProjection(surface);
  const frontViewPaths = placeDesign(design, placement);
  const projected = projectDesign(frontViewPaths, projection);
  const warnings: TemplateWarning[] = designWarnings({ design, placement, projection, projected });
  if (!flatten) return { surface: surfaceParameters, design: projected, template: null, warnings };

  const margin = input.margin !== undefined && input.margin > 0 ? input.margin : defaultMargin();
  const slitOptions = input.slits ?? defaultSlits();
  const { count } = slitOptions;
  const steps = flattenDesign({
    surface,
    projection,
    center: { x: 0, y: placement.verticalOffset },
    paths: frontViewPaths,
    margin,
    slits: {
      count: count === "auto" ? count : Math.max(0, Math.round(count)),
      depth: slitOptions.depth,
      clearance: SLIT_CLEARANCE_MM,
      spacing: SLIT_SPACING_MM,
      minDepth: Math.min(MIN_SLIT_DEPTH_MM, MIN_MARGIN_SHARE * (margin - SLIT_CLEARANCE_MM)),
    },
  });
  let next = steps.next();
  for (; !next.done; next = steps.next()) yield { slits: next.value };
  const flat = next.value;

  let template: FlatTemplate | null = null;
  if (flat && flat.paths.length > 0) {
    template = {
      designPaths: flat.paths,
      cutOutline: flat.outline,
      slits: flat.slits,
      stretch: stretchMap(flat.mesh, flat.flat),
    };
  }

  if (template && count !== "auto" && template.slits.length < count) {
    const fit = template.slits.length;
    warnings.push({
      kind: "slits-dont-fit",
      count: fit,
      message:
        fit === 0
          ? `None of the ${count} slits fit: the design leaves no blank paper deep enough for one.`
          : `Only ${fit} of the ${count} slits fit: the design leaves no more blank paper deep enough for one, clear of the others.`,
    });
  }
  if (template && flat?.overTarget) {
    const n = template.slits.length;
    const slits = n === 0 ? "No slits help enough here" : n === 1 ? "Even with its slit" : `Even with ${n} slits`;
    warnings.push({
      kind: "slit-limit",
      message: `${slits}: parts of the template will still stretch more than 3 %, so expect some wrinkles there. A smaller design helps, or a wider margin, which leaves room for deeper slits.`,
    });
  }
  return { surface: surfaceParameters, design: projected, template, warnings };
}
