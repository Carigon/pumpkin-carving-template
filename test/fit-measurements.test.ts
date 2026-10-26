import { describe, expect, it } from "vitest";
import { buildTemplate, fitProfile, type PumpkinMeasurements } from "../src/core";

/** Millimetres per inch and per centimetre. */
const IN = 25.4;
const CM = 10;

const widestOnly = (circumference: number, height: number): PumpkinMeasurements => ({
  height,
  rings: [{ circumference, position: 0.5 }],
});

describe("fitting the pumpkin surface to a height and one ring at mid-height", () => {
  it.each([
    ["squat", 40 * IN, 10 * IN, IN],
    ["tall", 30 * IN, 13 * IN, IN],
    ["large, slightly squat", 90 * CM, 25 * CM, CM],
  ] as const)("gives the ellipsoid with semi-axes C/2π, C/2π, H/2 for a %s pumpkin", (_name, circumference, height, unit) => {
    const square = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]].map(([x, y]) => ({ x, y }));
    const { surface, design, warnings } = buildTemplate({
      measurements: widestOnly(circumference, height),
      design: { paths: [square], bbox: { minX: -1.5, minY: -1.5, maxX: 1.5, maxY: 1.5 } },
      placement: { width: 3 * unit, verticalOffset: 0.5 * unit, rotation: 0 },
    });

    expect(warnings).toEqual([]);
    const a = circumference / (2 * Math.PI), c = height / 2;
    expect(surface!.kind).toBe("ellipsoid");
    expect(surface!.semiAxes.sideToSide).toBeCloseTo(a, 6);
    expect(surface!.semiAxes.frontToBack).toBeCloseTo(a, 6);
    expect(surface!.semiAxes.vertical).toBeCloseTo(c, 6);
    expect(surface!.profile[0].height).toBeCloseTo(c, 9);
    expect(surface!.profile[surface!.profile.length - 1].height).toBeCloseTo(-c, 9);
    for (const p of surface!.profile) expect((p.radius / a) ** 2 + (p.height / c) ** 2).toBeCloseTo(1, 6);
    // The 3D surface itself, not just the reported profile: a mesh within 0.25 mm of it. A point that far off the
    // ellipsoid scales its radius by at most 1 ± 0.25 mm / (the smaller semi-axis).
    const tolerance = 0.25 / Math.min(a, c);
    for (const p of design!.paths[0].points) {
      const [x, y, z] = p.surface!.point;
      expect(Math.abs(Math.sqrt((x / a) ** 2 + (y / c) ** 2 + (z / a) ** 2) - 1)).toBeLessThan(tolerance);
    }
  });

  it("gives a sphere when the height is the circumference over π", () => {
    const { surface, warnings } = buildTemplate({ measurements: widestOnly(30 * IN, (30 * IN) / Math.PI) });

    const R = (30 * IN) / (2 * Math.PI);
    expect(warnings).toEqual([]);
    expect(surface!.semiAxes.sideToSide).toBeCloseTo(R, 6);
    expect(surface!.semiAxes.frontToBack).toBeCloseTo(R, 6);
    expect(surface!.semiAxes.vertical).toBeCloseTo(R, 6);
    for (const p of surface!.profile) expect(Math.hypot(p.radius, p.height)).toBeCloseTo(R, 6);
  });
});

describe("impossible measurements", () => {
  const ring = (position: number, circumference = 30 * IN) => ({ position, circumference });
  const impossible: [string, Partial<PumpkinMeasurements>, { field: string; ring?: number }][] = [
    ["a height of zero", { height: 0 }, { field: "height" }],
    ["a negative height", { height: -9 * IN }, { field: "height" }],
    ["a missing height", { height: Number.NaN }, { field: "height" }],
    ["no rings", { rings: [] }, { field: "ring" }],
    ["a ring on the table", { rings: [ring(0)] }, { field: "ring", ring: 0 }],
    ["a ring at the very top", { rings: [ring(0.5), ring(1, 10 * IN)] }, { field: "ring", ring: 1 }],
    ["a ring above the pumpkin", { rings: [ring(1.2)] }, { field: "ring", ring: 0 }],
    ["a ring with no height", { rings: [ring(Number.NaN)] }, { field: "ring", ring: 0 }],
    ["a ring with no circumference", { rings: [ring(0.5), ring(0.3, Number.NaN)] }, { field: "ring", ring: 1 }],
    ["a ring with a negative circumference", { rings: [ring(0.5, -30 * IN)] }, { field: "ring", ring: 0 }],
    ["two rings at the same height", { rings: [ring(0.5), ring(0.25, 20 * IN), ring(0.5, 28 * IN)] }, { field: "ring", ring: 2 }],
  ];
  /** Rings no smooth shape passes through: a much narrower ring just above the widest. */
  const noShape: PumpkinMeasurements = { height: 9 * IN, rings: [ring(0.25, 25 * IN), ring(0.45), ring(0.452, 12 * IN)] };

  it.each(impossible)("%s gives a warning on that field instead of geometry", (_name, extra, where) => {
    const { surface, warnings } = buildTemplate({ measurements: { ...widestOnly(30 * IN, 9 * IN), ...extra } });

    expect(surface).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "impossible-measurement", ...where });
    expect(warnings[0]).toHaveProperty("message", expect.stringMatching(/\S/));
  });

  it("rings no smooth shape passes through give one warning on the rings as a whole, naming none of them", () => {
    const { surface, warnings } = buildTemplate({ measurements: noShape });

    expect(surface).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "impossible-measurement", field: "ring" });
    expect(warnings[0]).not.toHaveProperty("ring");
    expect(warnings[0]).toHaveProperty("message", expect.stringMatching(/No smooth pumpkin shape/));
  });

  it.each([
    ...impossible.map(([name, extra]): [string, PumpkinMeasurements] => [name, { ...widestOnly(30 * IN, 9 * IN), ...extra }]),
    ["rings no smooth shape passes through", noShape],
  ])("fitting the profile alone gives the template builder's warnings for %s", (_name, m) => {
    expect(fitProfile(m)).toEqual({ ok: false, warnings: buildTemplate({ measurements: m }).warnings });
  });
});
