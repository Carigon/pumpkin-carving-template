import { init, potrace } from "esm-potrace-wasm";
import type { Design } from "../core";
import { binarize } from "./rasterPrep";
import { readSvgDesign } from "./svgDesign";

export interface TraceSettings {
  /** Luminance cutoff 0..255: darker pixels are carved. */
  threshold: number;
  /** Carve the light parts instead (white-on-black stencils). */
  invert: boolean;
  /** Speckle removal: drop blobs of at most this many pixels (Potrace turdsize). */
  speckle: number;
}

export interface TraceResult {
  /** Potrace's SVG, for showing the traced result. */
  svg: string;
  /** Closed segmented paths, same format as SVG input; null when nothing was traced. */
  design: Design | null;
  notes: string[];
}

let ready: Promise<void> | null = null;

/**
 * Trace the cleaned-up photo's pixels into a design entirely in the browser: grayscale + threshold (+ invert),
 * Potrace with speckle removal, then the SVG input path for segmentation.
 */
export async function traceImage(pixels: ImageData, settings: TraceSettings): Promise<TraceResult> {
  ready ??= init();
  await ready;

  const bw = new ImageData(binarize(pixels.data, settings), pixels.width, pixels.height);

  const svg = await potrace(bw, {
    extractcolors: false,
    turdsize: Math.max(0, Math.round(settings.speckle)),
    turnpolicy: 4,
    alphamax: 1,
    opticurve: 1,
    opttolerance: 0.2,
    pathonly: false,
  });

  const { design, notes } = readSvgDesign(svg);
  return { svg, design, notes: design ? notes : ["Nothing was traced. Try another threshold or invert."] };
}
