import { describe, expect, it } from "vitest";
import { buildTemplate, type Design, type Point2 } from "../src/core";

function designOf(...paths: [number, number][][]): Design {
  const all = paths.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  return {
    paths: paths.map((path) => path.map(([x, y]) => ({ x, y }))),
    bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

function bboxOf(points: Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

describe("flattening on a sphere", () => {
  const CIRCUMFERENCE = 60;
  const R = CIRCUMFERENCE / (2 * Math.PI);
  const sphere = { circumference: CIRCUMFERENCE, frontArc: CIRCUMFERENCE / 2, units: "in" as const };
  const deg = Math.PI / 180;

  /** Front-view point whose surface point is `angle` from the front point, in direction `heading`. */
  const at = (angle: number, heading: number): [number, number] => [
    R * Math.sin(angle) * Math.cos(heading),
    R * Math.sin(angle) * Math.sin(heading),
  ];
  /** A thin closed spoke from `inner` to `outer` (angles from the front) along `heading`. */
  const spoke = (inner: number, outer: number, heading: number): [number, number][] => [
    at(inner, heading),
    at(outer, heading),
    at(outer - 0.5 * deg, heading + 2 * deg),
  ];

  // Paper can't lie flat on a sphere: without slits, ARAP spreads a few percent of shrink over the patch,
  // growing with its size (about θ²/12 for a patch reaching θ from its center).
  it.each([
    ["a design spanning 40°", 20, 0.02],
    ["a design spanning 80°", 40, 0.05],
  ])("%s: distances out from the design center match true surface distances", (_, reach, tolerance) => {
    const headings = [0, 45, 90, 135, 180, 225, 270, 315].map((h) => h * deg);
    const inner = 5 * deg;
    const outer = reach * deg;
    const { template } = buildTemplate({
      measurements: sphere,
      design: designOf(...headings.map((h) => spoke(inner, outer, h))),
      placement: { width: 2 * R * Math.sin(outer), verticalOffset: 0, rotation: 0 },
    });

    expect(template).not.toBeNull();
    for (const [i, path] of template!.designPaths.entries()) {
      const distances = path.map((p) => Math.hypot(p.x, p.y));
      // On a sphere the true distance from the front point is R times the angle.
      expect(Math.abs(Math.min(...distances) / (R * inner) - 1), `spoke ${i} inner end`).toBeLessThan(tolerance);
      expect(Math.abs(Math.max(...distances) / (R * outer) - 1), `spoke ${i} tip`).toBeLessThan(tolerance);
    }
  });

  it("the stem direction points up on paper", () => {
    // An upward spoke (toward the stem) and a downward one, so the design stays centered.
    const design = designOf(spoke(5 * deg, 30 * deg, 90 * deg), spoke(5 * deg, 15 * deg, 270 * deg));
    const { template } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: design.bbox.maxX - design.bbox.minX, verticalOffset: 0, rotation: 0 },
    });

    const tip = template!.designPaths[0].reduce((a, b) => (b.y > a.y ? b : a));
    expect(tip.y).toBeGreaterThan(0);
    expect(Math.abs(tip.x)).toBeLessThan(0.05 * tip.y);
  });
});

describe("scale of the flat template", () => {
  // A huge sphere is almost flat over a few inches, so the template should match the front view 1:1.
  const huge = { circumference: 2000, frontArc: 1000, units: "in" as const };

  it("a design 4 in wide seen from the front comes out 4 in wide on paper", () => {
    const { template } = buildTemplate({
      measurements: huge,
      design: designOf([[0, 0], [4, 0], [4, 2], [0, 2]]),
      placement: { width: 4, verticalOffset: 0, rotation: 0 },
    });

    const box = bboxOf(template!.designPaths.flat());
    expect(template!.units).toBe("in");
    expect(box.maxX - box.minX).toBeCloseTo(4, 2);
    expect(box.maxY - box.minY).toBeCloseTo(2, 2);
    // Centered on the design center, stem (+y) up.
    expect(box.minX).toBeCloseTo(-2, 2);
    expect(box.maxY).toBeCloseTo(1, 2);
  });

  it.each([
    ["in", 0.75],
    ["cm", 1.905],
  ] as const)("the cut-out outline is the design's outline grown by 3/4 in (%s)", (units, margin) => {
    const { template } = buildTemplate({
      measurements: { ...huge, units },
      design: designOf([[0, 0], [4, 0], [4, 2], [0, 2]]),
      placement: { width: 4, verticalOffset: 0, rotation: 0 },
    });

    const box = bboxOf(template!.cutOutline);
    expect(template!.units).toBe(units);
    expect(box.minX).toBeCloseTo(-2 - margin, 2);
    expect(box.maxX).toBeCloseTo(2 + margin, 2);
    expect(box.minY).toBeCloseTo(-1 - margin, 2);
    expect(box.maxY).toBeCloseTo(1 + margin, 2);
  });

  it("a design that misses the pumpkin entirely gives no template", () => {
    const { template } = buildTemplate({
      measurements: { circumference: 20, frontArc: 10, units: "in" },
      design: designOf([[0, 0], [1, 0], [1, 1]]),
      placement: { width: 1, verticalOffset: 50, rotation: 0 },
    });

    expect(template).toBeNull();
  });
});
