import { describe, expect, it } from "vitest";
import { binarize, fitWithin } from "../src/input/rasterPrep";

/** RGBA bytes from [r, g, b, a] tuples. */
function px(...pixels: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];

describe("binarize: grayscale + threshold (+ invert) into carve/keep pixels", () => {
  it("dark pixels become black (carve), light ones white (keep), all opaque", () => {
    const out = binarize(px([20, 20, 20, 255], [240, 240, 240, 255]), { threshold: 128, invert: false });
    expect(Array.from(out)).toEqual([...BLACK, ...WHITE]);
  });

  it("invert swaps carve and keep, for white-on-black stencils", () => {
    const out = binarize(px([20, 20, 20, 255], [240, 240, 240, 255]), { threshold: 128, invert: true });
    expect(Array.from(out)).toEqual([...WHITE, ...BLACK]);
  });

  it("raising the threshold carves mid-gray that a lower one keeps", () => {
    const gray = px([150, 150, 150, 255]);
    expect(Array.from(binarize(gray, { threshold: 128, invert: false }))).toEqual(WHITE);
    expect(Array.from(binarize(gray, { threshold: 200, invert: false }))).toEqual(BLACK);
  });

  it("transparent pixels count as white paper, even if their color is black", () => {
    const out = binarize(px([0, 0, 0, 0]), { threshold: 128, invert: false });
    expect(Array.from(out)).toEqual(WHITE);
  });
});

describe("fitWithin: downscale large scans before tracing", () => {
  it("leaves small images alone", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it("scales the long side down to the limit, keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1000, 5000, 2000)).toEqual({ width: 400, height: 2000 });
  });
});
