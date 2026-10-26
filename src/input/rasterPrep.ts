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

/** Size that fits `maxSide` on the long side (never upscales), keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
