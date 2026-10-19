import { describe, expect, it } from "vitest";
import { buildTemplate, convertLength, type PumpkinMeasurements } from "../src/core";

const widestOnly = (circumference: number, height: number, units: "in" | "cm" = "in"): PumpkinMeasurements => ({
  height,
  rings: [{ circumference, position: 0.5 }],
  units,
});

describe("fitting the pumpkin surface to a height and one ring at mid-height", () => {
  it.each([
    ["squat", 40, 10, "in"],
    ["tall", 30, 13, "in"],
    ["large, slightly squat", 90, 25, "cm"],
  ] as const)("gives the ellipsoid with semi-axes C/2π, C/2π, H/2 for a %s pumpkin", (_name, circumference, height, units) => {
    const square = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]].map(([x, y]) => ({ x, y }));
    const { surface, design, warnings } = buildTemplate({
      measurements: widestOnly(circumference, height, units),
      design: { paths: [square], bbox: { minX: -1.5, minY: -1.5, maxX: 1.5, maxY: 1.5 } },
      placement: { width: 3, verticalOffset: 0.5, rotation: 0 },
    });

    expect(warnings).toEqual([]);
    const a = circumference / (2 * Math.PI), c = height / 2;
    expect(surface!.kind).toBe("ellipsoid");
    expect(surface!.units).toBe(units);
    expect(surface!.semiAxes.sideToSide).toBeCloseTo(a, 6);
    expect(surface!.semiAxes.frontToBack).toBeCloseTo(a, 6);
    expect(surface!.semiAxes.vertical).toBeCloseTo(c, 6);
    expect(surface!.profile[0].height).toBeCloseTo(c, 9);
    expect(surface!.profile[surface!.profile.length - 1].height).toBeCloseTo(-c, 9);
    for (const p of surface!.profile) expect((p.radius / a) ** 2 + (p.height / c) ** 2).toBeCloseTo(1, 6);
    // The 3D surface itself, not just the reported profile: a mesh within 0.25 mm of it. A point that far off the
    // ellipsoid scales its radius by at most 1 ± 0.25 mm / (the smaller semi-axis).
    const tolerance = convertLength(0.025, "cm", units) / Math.min(a, c);
    for (const p of design!.paths[0].points) {
      const [x, y, z] = p.surface!.point;
      expect(Math.abs(Math.sqrt((x / a) ** 2 + (y / c) ** 2 + (z / a) ** 2) - 1)).toBeLessThan(tolerance);
    }
  });

  it("gives a sphere when the height is the circumference over π", () => {
    const { surface, warnings } = buildTemplate({ measurements: widestOnly(30, 30 / Math.PI) });

    const R = 30 / (2 * Math.PI);
    expect(warnings).toEqual([]);
    expect(surface!.semiAxes.sideToSide).toBeCloseTo(R, 6);
    expect(surface!.semiAxes.frontToBack).toBeCloseTo(R, 6);
    expect(surface!.semiAxes.vertical).toBeCloseTo(R, 6);
    for (const p of surface!.profile) expect(Math.hypot(p.radius, p.height)).toBeCloseTo(R, 6);
  });
});

describe("impossible measurements", () => {
  const ring = (position: number, circumference = 30) => ({ position, circumference });
  it.each<[string, Partial<PumpkinMeasurements>, { field: string; ring?: number }]>([
    ["a height of zero", { height: 0 }, { field: "height" }],
    ["a negative height", { height: -9 }, { field: "height" }],
    ["a missing height", { height: Number.NaN }, { field: "height" }],
    ["no rings", { rings: [] }, { field: "ring" }],
    ["a ring on the table", { rings: [ring(0)] }, { field: "ring", ring: 0 }],
    ["a ring at the very top", { rings: [ring(0.5), ring(1, 10)] }, { field: "ring", ring: 1 }],
    ["a ring above the pumpkin", { rings: [ring(1.2)] }, { field: "ring", ring: 0 }],
    ["a ring with no height", { rings: [ring(Number.NaN)] }, { field: "ring", ring: 0 }],
    ["a ring with no circumference", { rings: [ring(0.5), ring(0.3, Number.NaN)] }, { field: "ring", ring: 1 }],
    ["a ring with a negative circumference", { rings: [ring(0.5, -30)] }, { field: "ring", ring: 0 }],
    ["two rings at the same height", { rings: [ring(0.5), ring(0.25, 20), ring(0.5, 28)] }, { field: "ring", ring: 2 }],
  ])("%s gives a warning on that field instead of geometry", (_name, extra, where) => {
    const { surface, warnings } = buildTemplate({ measurements: { ...widestOnly(30, 9), ...extra } });

    expect(surface).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "impossible-measurement", ...where });
    expect(warnings[0].message).not.toBe("");
  });
});
