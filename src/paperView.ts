import type { Point2 } from "./core";
import { layoutTemplatePdf, type TemplatePage, type TemplatePdfInput } from "./pdf/layout";
import { stretchTint } from "./stretchTint";

/** One triangle of the flattened patch on the paper, with how much the paper stretches there. */
export interface PaperStretch {
  corners: [Point2, Point2, Point2];
  /** The stretch (0.05 = 5 %). */
  value: number;
  /** Tint strength, 0 (none) to 1 (full), with the same thresholds as the 3D view's tint. */
  tint: number;
}

/**
 * What the Paper view draws: the flat template across the printed pages. Everything is in the template's frame
 * and units (origin at the design center, +y toward the stem), so the view only has to scale and flip it.
 */
export interface PaperView {
  /** The cut-out edge (closed), or null when the cut line isn't printed. */
  outline: Point2[] | null;
  /** The paper left after cutting (the cut-out shape, whether or not its line is printed), to clip the tint to. */
  paperArea: Point2[];
  /** Slits (open polylines, drawn dashed). None for a test grid. */
  slits: Point2[][];
  /** Design lines (closed; holes are nested paths). */
  design: Point2[][];
  /** The flat side of the stretch map. */
  stretch: PaperStretch[];
  /** The pages that carry the template, from the PDF's own page layout. */
  pages: TemplatePage[];
  /** Every page of the PDF, including the info page when there is one. */
  pageCount: number;
}

/**
 * The Paper view's geometry for the template the worker built and the paper choice. The pages come from the
 * PDF page layout itself, so the view and the downloaded PDF agree on how many pages there are and where they split.
 */
export function paperView(source: TemplatePdfInput): PaperView {
  const layout = layoutTemplatePdf(source);
  const { template, cut } = source;
  const { flat, triangles, values } = template.stretch;
  return {
    // Like the PDF: the cut-out edge shows unless the cut line is turned off.
    outline: cut?.line === false ? null : template.cutOutline,
    paperArea: template.cutOutline,
    slits: template.slits,
    design: template.designPaths,
    stretch: triangles.map(([a, b, c], t) => ({
      corners: [flat[a], flat[b], flat[c]],
      value: values[t],
      tint: stretchTint(values[t]),
    })),
    pages: layout.templatePages,
    pageCount: layout.pages.length,
  };
}
