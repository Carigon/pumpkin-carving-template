import { describe, expect, it } from "vitest";
import { buildTemplate } from "../src/core";
import { ballMeasurements, gridDesign } from "../src/input/calibrationGrid";
import { layoutTemplatePdf } from "../src/pdf/layout";

function bboxOf(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

describe("calibration grid design", () => {
  it("is a square: an outer square with n x n equal square cells as holes", () => {
    const design = gridDesign(4);

    expect(design.bbox.maxX - design.bbox.minX).toBeCloseTo(design.bbox.maxY - design.bbox.minY, 9);
    expect(design.paths).toHaveLength(1 + 16);
    const [outer, ...cells] = design.paths.map(bboxOf);
    expect(outer).toEqual(design.bbox);
    const size = cells[0].maxX - cells[0].minX;
    for (const cell of cells) {
      expect(cell.maxX - cell.minX).toBeCloseTo(size, 9);
      expect(cell.maxY - cell.minY).toBeCloseTo(size, 9);
    }
    // Four cells plus five bars across the width; the bars are thinner than the cells.
    const outerWidth = outer.maxX - outer.minX;
    const bar = (outerWidth - 4 * size) / 5;
    expect(bar).toBeGreaterThan(0);
    expect(bar).toBeLessThan(size);
  });
});

describe("ball measurements", () => {
  it("model a sphere from a single circumference: as tall as it is wide, widest at mid-height", () => {
    expect(ballMeasurements(750)).toEqual({ height: 750 / Math.PI, rings: [{ circumference: 750, position: 0.5 }] });
  });
});

describe("calibration grid on a basketball", () => {
  /** A basketball's circumference, 29.5 in, in mm. */
  const ball = 29.5 * 25.4;
  const measurements = ballMeasurements(ball);
  const placement = { width: 5 * 25.4, verticalOffset: 0, rotation: 0 };
  // Test-grid mode prints no slits: a grid is one solid carve area with no blank paper for them.
  const result = buildTemplate({ measurements, design: gridDesign(6), placement, slits: { count: 0, depth: 0 } });

  it("goes through the normal pipeline to a flat template with every cell", () => {
    expect(result.surface?.semiAxes.sideToSide).toBeCloseTo(ball / (2 * Math.PI), 5);
    expect(result.surface?.semiAxes.vertical).toBeCloseTo(ball / (2 * Math.PI), 5);
    // The grid is printed, not carved, so its cells being floating pieces of paper is expected: test-grid mode
    // doesn't show shape warnings.
    expect(result.warnings.map((w) => w.kind)).toEqual(["floating-piece"]);
    expect(result.warnings[0].kind === "floating-piece" && result.warnings[0].pieces).toHaveLength(36);
    expect(result.template?.designPaths).toHaveLength(1 + 36);
  });

  it("flattens to a square, wider than its front view because the paper wraps the curve", () => {
    const outer = bboxOf(result.template!.designPaths.flat());
    const width = outer.maxX - outer.minX;
    const height = outer.maxY - outer.minY;
    // By symmetry the grid flattens exactly as wide as tall.
    expect(Math.abs(width / height - 1)).toBeLessThan(0.002);
    expect(width).toBeGreaterThan(placement.width);
  });

  it("exports through the PDF path with an info block naming it a calibration grid for the ball", () => {
    const layout = layoutTemplatePdf({
      template: result.template!,
      surface: result.surface!,
      measurements,
      placement,
      slits: { count: 0, depth: 0 },
      calibrationBall: ball,
      units: "in",
    });
    const text = layout.pages.flatMap((p) => p.marks).flatMap((m) => (m.kind === "text" ? [m.text] : []));
    expect(text).toContain("Calibration grid for a 29.5 in ball");
    expect(text.some((t) => /pumpkin carving template/i.test(t))).toBe(false);
  });
});
