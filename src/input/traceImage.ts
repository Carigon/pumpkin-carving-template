import { init, potrace } from "esm-potrace-wasm";
import type { Design } from "../core";
import { binarize, clampCrop, fitWithin, type PixelRect } from "./rasterPrep";
import { readSvgDesign } from "./svgDesign";

/** Long-side limit for tracing; bigger scans are downscaled first to keep tracing quick. */
const MAX_TRACE_SIDE = 2000;

export interface TraceSettings {
  /** Luminance cutoff 0..255: darker pixels are carved. */
  threshold: number;
  /** Carve the light parts instead (white-on-black stencils). */
  invert: boolean;
  /** Speckle removal: drop blobs of at most this many pixels (Potrace turdsize). */
  speckle: number;
  /** Crop rectangle in source-image pixels; whole image when absent. */
  crop?: PixelRect;
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
 * Trace a raster image into a design entirely in the browser: crop, grayscale + threshold (+ invert),
 * Potrace with speckle removal, then the SVG input path for segmentation.
 */
export async function traceImage(image: ImageBitmap, settings: TraceSettings): Promise<TraceResult> {
  ready ??= init();
  await ready;

  const crop = clampCrop(settings.crop ?? { x: 0, y: 0, width: image.width, height: image.height }, image.width, image.height);
  const size = fitWithin(crop.width, crop.height, MAX_TRACE_SIDE);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const g = canvas.getContext("2d")!;
  g.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  const pixels = g.getImageData(0, 0, size.width, size.height);
  const bw = new ImageData(binarize(pixels.data, settings), size.width, size.height);

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
