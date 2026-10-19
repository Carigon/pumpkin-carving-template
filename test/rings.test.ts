import { describe, expect, it } from "vitest";
import { buildTemplate, type PumpkinMeasurements, type SurfaceParameters } from "../src/core";

/** Perimeter of an ellipse with semi-axes a and b, as the length of a fine inscribed polygon. */
function ellipsePerimeter(a: number, b: number): number {
  const n = 20_000;
  let length = 0;
  for (let i = 0; i < n; i++) {
    const t0 = (2 * Math.PI * i) / n, t1 = (2 * Math.PI * (i + 1)) / n;
    length += Math.hypot(a * (Math.cos(t1) - Math.cos(t0)), b * (Math.sin(t1) - Math.sin(t0)));
  }
  return length;
}

/** The front meridian of the fitted surface (front-to-back radius against height), stem to base. */
function frontMeridian(surface: SurfaceParameters) {
  return surface.profile.map((p) => ({ r: p.radius, rho: p.radius * surface.depthRatio, y: p.height }));
}

/** Length of the front meridian, stem to base. */
function frontArcOf(surface: SurfaceParameters): number {
  const m = frontMeridian(surface);
  let length = 0;
  for (let i = 1; i < m.length; i++) length += Math.hypot(m[i].rho - m[i - 1].rho, m[i].y - m[i - 1].y);
  return length;
}

/** Circumference of the horizontal cross-section `distance` along the front arc from the stem. */
function circumferenceAt(surface: SurfaceParameters, distance: number): number {
  const m = frontMeridian(surface);
  let walked = 0;
  for (let i = 1; i < m.length; i++) {
    const step = Math.hypot(m[i].rho - m[i - 1].rho, m[i].y - m[i - 1].y);
    if (walked + step >= distance) {
      const t = (distance - walked) / step;
      const r = m[i - 1].r + t * (m[i].r - m[i - 1].r);
      return ellipsePerimeter(r, r * surface.depthRatio);
    }
    walked += step;
  }
  return 0;
}

const height = (s: SurfaceParameters) => s.profile[0].height - s.profile[s.profile.length - 1].height;

describe("pumpkin profile from extra circumference rings", () => {
  it.each<[string, PumpkinMeasurements]>([
    [
      "a bottom-heavy pumpkin",
      { circumference: 32, frontArc: 18, circumferenceAt: 11, rings: [{ distance: 4, circumference: 22 }, { distance: 14, circumference: 20 }], units: "in" },
    ],
    [
      "a tapered pumpkin, widest point not given",
      { circumference: 30, frontArc: 16, rings: [{ distance: 3, circumference: 16 }, { distance: 11, circumference: 24 }], units: "in" },
    ],
    [
      "an oval pumpkin with depth",
      { circumference: 70, frontArc: 40, depth: 20, circumferenceAt: 20, rings: [{ distance: 8, circumference: 50 }, { distance: 30, circumference: 60 }], units: "cm" },
    ],
  ])("%s: the surface reproduces every ring and the front arc", (_name, measurements) => {
    const { surface, warnings } = buildTemplate({ measurements });

    expect(warnings).toEqual([]);
    expect(surface).not.toBeNull();
    expect(frontArcOf(surface!) / measurements.frontArc).toBeCloseTo(1, 3);
    for (const ring of measurements.rings!) {
      expect(circumferenceAt(surface!, ring.distance) / ring.circumference).toBeCloseTo(1, 3);
    }
    if (measurements.circumferenceAt !== undefined) {
      expect(circumferenceAt(surface!, measurements.circumferenceAt) / measurements.circumference).toBeCloseTo(1, 3);
    } else {
      const widest = Math.max(...surface!.profile.map((p) => p.radius));
      expect(ellipsePerimeter(widest, widest * surface!.depthRatio) / measurements.circumference).toBeCloseTo(1, 3);
    }
    if (measurements.depth !== undefined) {
      const widest = Math.max(...surface!.profile.map((p) => p.radius));
      expect(2 * widest * surface!.depthRatio).toBeCloseTo(measurements.depth, 3);
    }
  });
});
