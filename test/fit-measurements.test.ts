import { describe, expect, it } from "vitest";
import { buildTemplate } from "../src/core";

describe("fitting the pumpkin surface to measurements", () => {
  it("gives a sphere when the front arc is half the circumference", () => {
    const result = buildTemplate({
      measurements: { circumference: 30, frontArc: 15, units: "in" },
    });

    const R = 30 / (2 * Math.PI);
    expect(result.warnings).toEqual([]);
    expect(result.surface).not.toBeNull();
    expect(result.surface!.semiAxes.sideToSide).toBeCloseTo(R, 4);
    expect(result.surface!.semiAxes.frontToBack).toBeCloseTo(R, 4);
    expect(result.surface!.semiAxes.vertical).toBeCloseTo(R, 4);
    expect(result.surface!.units).toBe("in");
  });

  it.each([
    ["squat", 40, 14],
    ["tall", 30, 22],
    ["large, slightly squat", 90, 40],
  ])(
    "reproduces the circumference and front arc for a %s pumpkin",
    (_name, circumference, frontArc) => {
      const { surface, warnings } = buildTemplate({
        measurements: { circumference, frontArc, units: "in" },
      });

      expect(warnings).toEqual([]);
      const { sideToSide, frontToBack, vertical } = surface!.semiAxes;
      expect(ellipsePerimeter(sideToSide, frontToBack)).toBeCloseTo(circumference, 3);
      expect(ellipsePerimeter(frontToBack, vertical) / 2).toBeCloseTo(frontArc, 3);
    },
  );

  it.each([
    ["oval", 36, 16, 10],
    ["oval and tall", 30, 20, 8],
  ])(
    "with depth, sets front-to-back from depth and reproduces circumference and arc for an %s pumpkin",
    (_name, circumference, frontArc, depth) => {
      const { surface, warnings } = buildTemplate({
        measurements: { circumference, frontArc, depth, units: "cm" },
      });

      expect(warnings).toEqual([]);
      const { sideToSide, frontToBack, vertical } = surface!.semiAxes;
      expect(frontToBack).toBeCloseTo(depth / 2, 6);
      expect(ellipsePerimeter(sideToSide, frontToBack)).toBeCloseTo(circumference, 3);
      expect(ellipsePerimeter(frontToBack, vertical) / 2).toBeCloseTo(frontArc, 3);
      expect(surface!.units).toBe("cm");
    },
  );
});

describe("impossible measurements", () => {
  it.each([
    // An arc can't be shorter than the straight-through diameter (C/π ≈ 9.55 for C = 30).
    ["front arc too short for the circumference", { circumference: 30, frontArc: 9 }, "frontArc"],
    ["front arc of zero", { circumference: 30, frontArc: 0 }, "frontArc"],
    ["negative circumference", { circumference: -30, frontArc: 15 }, "circumference"],
    ["non-numeric circumference", { circumference: Number.NaN, frontArc: 15 }, "circumference"],
    // Circumference must exceed twice the depth (a flat ellipse of that depth).
    ["depth too large for the circumference", { circumference: 30, frontArc: 15, depth: 16 }, "depth"],
    ["depth of zero", { circumference: 30, frontArc: 15, depth: 0 }, "depth"],
    // With depth 6, the arc must exceed 6.
    ["front arc too short for the depth", { circumference: 30, frontArc: 5.5, depth: 6 }, "frontArc"],
  ] as const)("%s gives a warning on that field instead of geometry", (_name, m, field) => {
    const { surface, warnings } = buildTemplate({ measurements: { ...m, units: "in" } });

    expect(surface).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "impossible-measurement", field });
    expect(warnings[0].message).not.toBe("");
  });
});

/** Perimeter of an ellipse, measured as the length of a fine inscribed polygon. */
function ellipsePerimeter(a: number, b: number): number {
  const n = 200_000;
  let length = 0;
  let px = a;
  let py = 0;
  for (let i = 1; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    length += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return length;
}
