/** Settings for turning a scan into pure carve/keep pixels before tracing. */
export interface BinarizeOptions {
  /** Luminance cutoff 0..255: pixels darker than this are carved. */
  threshold: number;
  /** Swap carve and keep (for white-on-black stencils). */
  invert: boolean;
}

/**
 * Grayscale + threshold an RGBA buffer into opaque black (carve) / white (keep) pixels, which is what
 * Potrace's monochrome mode expects. Transparent pixels count as white paper.
 */
export function binarize(rgba: Uint8ClampedArray, { threshold, invert }: BinarizeOptions): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    const a = rgba[i + 3] / 255;
    const onWhite = lum * a + 255 * (1 - a);
    const carve = onWhite < threshold !== invert;
    const v = carve ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** Rectangle in source-image pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Snap a crop rectangle to whole pixels inside a `w`×`h` image, at least 1×1. */
export function clampCrop(r: PixelRect, w: number, h: number): PixelRect {
  const x0 = clamp(Math.round(r.x), 0, w - 1);
  const y0 = clamp(Math.round(r.y), 0, h - 1);
  const x1 = clamp(Math.round(r.x + r.width), x0 + 1, w);
  const y1 = clamp(Math.round(r.y + r.height), y0 + 1, h);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Size that fits `maxSide` on the long side (never upscales), keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
