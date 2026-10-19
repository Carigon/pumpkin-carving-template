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

/** The largest radius on the front meridian and how far along the arc from the stem it is. */
function widestOf(surface: SurfaceParameters) {
  const m = frontMeridian(surface);
  let walked = 0, widestAt = 0, widest = 0;
  m.forEach((p, i) => {
    if (i > 0) walked += Math.hypot(p.rho - m[i - 1].rho, p.y - m[i - 1].y);
    if (p.r > widest) [widest, widestAt] = [p.r, walked];
  });
  return { widest, widestAt };
}

const height = (s: SurfaceParameters) => s.profile[0].height - s.profile[s.profile.length - 1].height;

describe("pumpkin profile from extra circumference rings", () => {
  it.each([
    ["round", undefined],
    ["oval", 9],
  ])("with only the widest ring (%s), the surface is the ellipsoid fit", (_name, depth) => {
    const plain = buildTemplate({ measurements: { circumference: 30, frontArc: 17, depth, units: "in" } });
    const ringed = buildTemplate({ measurements: { circumference: 30, frontArc: 17, depth, rings: [], units: "in" } });

    expect(ringed).toEqual(plain);
    expect(ringed.surface!.kind).toBe("ellipsoid");
  });

  // A barrel spends some of the front arc going across its flatter top and bottom, so it is less tall than the
  // ellipsoid; what sets it apart is its sides staying wide much further up and down.
  it("a design on a ringed pumpkin projects straight back onto it and flattens with little stretch", () => {
    const measurements: PumpkinMeasurements = {
      circumference: 32, frontArc: 20, circumferenceAt: 11,
      rings: [{ distance: 4, circumference: 22 }, { distance: 16, circumference: 22 }], units: "in",
    };
    const square = [[-2, -2], [2, -2], [2, 2], [-2, 2]].map(([x, y]) => ({ x, y }));
    const { surface, design, template, warnings } = buildTemplate({
      measurements,
      design: { paths: [square], bbox: { minX: -2, minY: -2, maxX: 2, maxY: 2 } },
      placement: { width: 4, verticalOffset: -1, rotation: 0 },
    });

    expect(warnings).toEqual([]);
    for (const p of design!.paths[0].points) {
      expect(p.surface!.point[0]).toBeCloseTo(p.front.x, 9);
      expect(p.surface!.point[1]).toBeCloseTo(p.front.y, 9);
      // On the surface: inside the profile's radius at that height, at the cross-section ellipse.
      const near = surface!.profile.reduce((a, b) => (Math.abs(b.height - p.front.y) < Math.abs(a.height - p.front.y) ? b : a));
      expect(Math.hypot(p.surface!.point[0], p.surface!.point[2]) / near.radius).toBeCloseTo(1, 2);
    }
    expect(template).not.toBeNull();
    expect(template!.stretch.max).toBeLessThan(0.06);
  });

  it("a sphere measured with rings comes out as that sphere", () => {
    const C = 40, R = C / (2 * Math.PI);
    const rings = [3, 7, 14, 17].map((distance) => ({ distance, circumference: C * Math.sin(distance / R) }));
    const { surface, warnings } = buildTemplate({ measurements: { circumference: C, frontArc: C / 2, rings, units: "in" } });

    expect(warnings).toEqual([]);
    expect(surface!.kind).toBe("revolved");
    expect(surface!.depthRatio).toBe(1);
    for (const p of surface!.profile) expect(Math.hypot(p.radius, p.height)).toBeCloseTo(R, 6);
    expect(surface!.semiAxes.vertical).toBeCloseTo(R, 6);
  });

  it("equal rings give a flatter-sided pumpkin than the ellipsoid with the same arc", () => {
    const base = { circumference: 30, frontArc: 18, units: "in" as const };
    const { surface: ellipsoid } = buildTemplate({ measurements: base });
    const { surface: barrel, warnings } = buildTemplate({
      measurements: {
        ...base,
        circumferenceAt: 9,
        rings: [{ distance: 6, circumference: 30 * 0.97 }, { distance: 12, circumference: 30 * 0.97 }],
      },
    });

    expect(warnings).toEqual([]);
    // Three quarters of the way from the middle to the stem, as a fraction of the widest radius:
    // cos(asin 0.75) ≈ 0.66 on the ellipsoid, much more on the barrel.
    const sideAt = (s: SurfaceParameters, fraction: number) => {
      const y = fraction * (height(s) / 2);
      const near = s.profile.reduce((a, b) => (Math.abs(b.height - y) < Math.abs(a.height - y) ? b : a));
      return near.radius / Math.max(...s.profile.map((p) => p.radius));
    };
    expect(sideAt(ellipsoid!, 0.75)).toBeCloseTo(Math.cos(Math.asin(0.75)), 2);
    expect(sideAt(barrel!, 0.75)).toBeGreaterThan(sideAt(ellipsoid!, 0.75) + 0.1);
    expect(sideAt(barrel!, -0.75)).toBeGreaterThan(sideAt(ellipsoid!, -0.75) + 0.1);
  });

  it.each<[string, Partial<PumpkinMeasurements>, { field: string; ring?: number }]>([
    // 2 in from the stem, the radius can be at most 2 in: circumference at most 4π ≈ 12.6.
    ["a ring too big for its place near the stem", { rings: [{ distance: 2, circumference: 16 }] }, { field: "ring", ring: 0 }],
    ["a ring too big for its place near the base", { rings: [{ distance: 4, circumference: 20 }, { distance: 16, circumference: 16 }] }, { field: "ring", ring: 1 }],
    // Rings 1 in apart can differ by at most 2π ≈ 6.3 in circumference.
    ["rings changing faster than the arc allows", { rings: [{ distance: 8, circumference: 28 }, { distance: 9, circumference: 20 }] }, { field: "ring", ring: 1 }],
    ["a ring bigger than the widest", { rings: [{ distance: 9, circumference: 31 }] }, { field: "ring", ring: 0 }],
    ["a ring off the end of the arc", { rings: [{ distance: 18, circumference: 10 }] }, { field: "ring", ring: 0 }],
    ["a ring with no circumference", { rings: [{ distance: 5, circumference: Number.NaN }] }, { field: "ring", ring: 0 }],
    ["the widest ring placed too close to the stem", { circumferenceAt: 3 }, { field: "circumferenceAt" }],
  ])("%s gives a warning on that ring instead of geometry", (_name, extra, where) => {
    const { surface, warnings } = buildTemplate({
      measurements: { circumference: 30, frontArc: 18, units: "in", ...extra },
    });

    expect(surface).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "impossible-measurement", ...where });
    expect(warnings[0].message).not.toBe("");
  });

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
    // Barrels and bulges that fit easily within the hard limit (issue #13).
    [
      "a symmetric barrel, widest point not given",
      { circumference: 30, frontArc: 17.5, rings: [{ distance: 5, circumference: 28 }, { distance: 12.5, circumference: 28 }], units: "in" },
    ],
    [
      "a barrel with four rings",
      {
        circumference: 30, frontArc: 17.5, circumferenceAt: 8.75,
        rings: [{ distance: 5, circumference: 28 }, { distance: 6.5, circumference: 29.5 }, { distance: 11, circumference: 29.5 }, { distance: 12.5, circumference: 28 }],
        units: "in",
      },
    ],
    [
      "a bottom-heavy bulge",
      { circumference: 30, frontArc: 18, circumferenceAt: 10.5, rings: [{ distance: 5, circumference: 25 }, { distance: 13, circumference: 28.5 }], units: "in" },
    ],
    [
      "a bottom-heavy bulge, widest point not given",
      { circumference: 30, frontArc: 18, rings: [{ distance: 5, circumference: 24 }, { distance: 13, circumference: 28.5 }], units: "in" },
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

  it.each<[string, PumpkinMeasurements]>([
    [
      "a barrel",
      { circumference: 30, frontArc: 17.5, circumferenceAt: 8.75, rings: [{ distance: 5, circumference: 28 }, { distance: 12.5, circumference: 28 }], units: "in" },
    ],
    [
      "a fuller barrel",
      { circumference: 30, frontArc: 17.5, circumferenceAt: 8.75, rings: [{ distance: 5, circumference: 28.5 }, { distance: 12.5, circumference: 28.5 }], units: "in" },
    ],
    [
      "a barrel in cm",
      { circumference: 80, frontArc: 48, circumferenceAt: 24, rings: [{ distance: 14, circumference: 76 }, { distance: 34, circumference: 76 }], units: "cm" },
    ],
    [
      "a bottom-heavy bulge",
      { circumference: 30, frontArc: 18, circumferenceAt: 10.5, rings: [{ distance: 5, circumference: 25 }, { distance: 13, circumference: 28.5 }], units: "in" },
    ],
    [
      "a bottom-heavy bulge, widest point not given",
      { circumference: 30, frontArc: 18, rings: [{ distance: 5, circumference: 24 }, { distance: 13, circumference: 28.5 }], units: "in" },
    ],
  ])("%s: the widest circumference is the largest anywhere on the pumpkin, where it was taken", (_name, measurements) => {
    const { surface, warnings } = buildTemplate({ measurements });

    expect(warnings).toEqual([]);
    const { widest, widestAt } = widestOf(surface!);
    expect(ellipsePerimeter(widest, widest * surface!.depthRatio) / measurements.circumference).toBeCloseTo(1, 3);
    if (measurements.circumferenceAt !== undefined) {
      expect(Math.abs(widestAt - measurements.circumferenceAt)).toBeLessThan(0.02 * measurements.frontArc);
    }
  });

  describe("with no widest position, a symmetric barrel", () => {
    const barrel = (lower: number): PumpkinMeasurements => ({
      circumference: 30, frontArc: 17.5, rings: [{ distance: 5, circumference: 28 }, { distance: 12.5, circumference: lower }], units: "in",
    });

    it("is widest at mid-arc and symmetric about mid-height", () => {
      const { surface, warnings } = buildTemplate({ measurements: barrel(28) });

      expect(warnings).toEqual([]);
      expect(Math.abs(widestOf(surface!).widestAt - 17.5 / 2)).toBeLessThan(0.02 * 17.5);
      const p = surface!.profile;
      for (let i = 0; i < p.length; i++) {
        expect(p[i].radius).toBeCloseTo(p[p.length - 1 - i].radius, 4);
        expect(p[i].height).toBeCloseTo(-p[p.length - 1 - i].height, 4);
      }
    });

    it("moves its widest point only slightly when one ring changes slightly", () => {
      const before = widestOf(buildTemplate({ measurements: barrel(28) }).surface!).widestAt;
      const after = widestOf(buildTemplate({ measurements: barrel(28.05) }).surface!).widestAt;

      expect(Math.abs(after - before)).toBeLessThan(0.03 * 17.5);
    });
  });
});
