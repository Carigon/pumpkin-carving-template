import { describe, expect, it } from "vitest";
import { buildTemplate, defaultMargin, type Design, type Point2 } from "../src/core";

function designOf(...paths: [number, number][][]): Design {
  const all = paths.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  return {
    paths: paths.map((path) => path.map(([x, y]) => ({ x, y }))),
    bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

/** Even-odd point-in-polygon test. */
function insidePolygon(p: Point2, polygon: Point2[]): boolean {
  let inside = false;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  });
  return inside;
}

/** Distance from p to the nearest segment of any closed path. */
function distanceToPaths(p: Point2, paths: Point2[][]): number {
  let best = Infinity;
  for (const path of paths) {
    path.forEach((a, i) => {
      const b = path[(i + 1) % path.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    });
  }
  return best;
}

function bboxOf(points: Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** mm per inch and per cm. */
const IN = 25.4;
const CM = 10;
/** The default paper margin between the design and the cut-out edge, in mm. */
const MARGIN = defaultMargin();

/** A sphere `circumference` mm around. */
const sphereAround = (circumference: number) => ({ height: circumference / Math.PI, rings: [{ circumference, position: 0.5 }] });

const CIRCUMFERENCE = 60 * IN;
const R = CIRCUMFERENCE / (2 * Math.PI);
const plainSphere = sphereAround(CIRCUMFERENCE);
/** The same sphere measured with more tape rings, a quarter and three quarters of the way up. */
const ringedSphere = {
  ...plainSphere,
  rings: [0.5, 0.25, 0.75].map((position) => ({
    position,
    circumference: 2 * Math.PI * Math.sqrt(R ** 2 - (2 * R * (position - 0.5)) ** 2),
  })),
};

describe.each([
  ["given as one circumference", plainSphere],
  ["given as rings", ringedSphere],
])("flattening on a sphere %s", (_name, sphere) => {
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

  // The paper follows the thin spokes (the cut-out edge hugs them), and narrow strips along great circles
  // lie almost flat, so distances along them come out nearly true (measured: about 0.2 %).
  it.each([
    ["a design spanning 40°", 20, 0.01],
    ["a design spanning 80°", 40, 0.01],
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
  const huge = sphereAround(2000 * IN);
  /** Within 0.005 in (0.127 mm). */
  const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.005 * IN);

  it("a design 4 in wide seen from the front comes out 4 in wide on paper", () => {
    const { template } = buildTemplate({
      measurements: huge,
      design: designOf([[0, 0], [4, 0], [4, 2], [0, 2]]),
      placement: { width: 4 * IN, verticalOffset: 0, rotation: 0 },
    });

    const box = bboxOf(template!.designPaths.flat());
    near(box.maxX - box.minX, 4 * IN);
    near(box.maxY - box.minY, 2 * IN);
    // Centered on the design center, stem (+y) up.
    near(box.minX, -2 * IN);
    near(box.maxY, 1 * IN);
  });

  // A huge sphere and design measured in inches, and one measured in cm: the margin is 20 mm whatever their size.
  it.each([
    ["4 in wide on a sphere 2000 in around", IN],
    ["4 cm wide on a sphere 2000 cm around", CM],
  ] as const)("the cut-out outline is the design's outline grown by 20 mm (a design %s)", (_, unit) => {
    const { template } = buildTemplate({
      measurements: sphereAround(2000 * unit),
      design: designOf([[0, 0], [4, 0], [4, 2], [0, 2]]),
      placement: { width: 4 * unit, verticalOffset: 0, rotation: 0 },
    });

    const box = bboxOf(template!.cutOutline);
    near(box.minX, -2 * unit - MARGIN);
    near(box.maxX, 2 * unit + MARGIN);
    near(box.minY, -1 * unit - MARGIN);
    near(box.maxY, 1 * unit + MARGIN);
  });

  it("the cut-out edge follows the design's outline into concave parts instead of cutting across them", () => {
    // An L, 4 in tall and wide and 2 in thick, with its inner corner at the design center (the origin).
    // Its notch is 2 in across, wider than two margins.
    const { template } = buildTemplate({
      measurements: huge,
      design: designOf([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]),
      placement: { width: 4 * IN, verticalOffset: 0, rotation: 0 },
    });

    const outline = template!.cutOutline;
    const design = template!.designPaths;
    // Every point of the edge is the margin from the design (to 0.05 in): the edge hugs the L all the way round.
    for (const p of outline) expect(Math.abs(distanceToPaths(p, design) - MARGIN)).toBeLessThan(0.05 * IN);
    // The design sits inside the edge; the notch doesn't.
    for (const p of design.flat()) expect(insidePolygon(p, outline)).toBe(true);
    expect(insidePolygon({ x: 1.5 * IN, y: 1.5 * IN }, outline)).toBe(false);
  });

  it.each([
    ["0.4 in, on a sphere 2000 in around", IN, 0.4 * IN],
    ["2 in, on a sphere 2000 in around", IN, 2 * IN],
    ["5 cm, on a sphere 2000 cm around", CM, 5 * CM],
  ] as const)("the cut-out edge stays the chosen margin from the design (margin %s)", (_, unit, margin) => {
    // The same L as above, 4 in wide; its notch is 2 in (5.08 cm) across.
    const { template } = buildTemplate({
      measurements: sphereAround(2000 * unit),
      design: designOf([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]),
      placement: { width: 4 * IN, verticalOffset: 0, rotation: 0 },
      margin,
    });

    const outline = template!.cutOutline;
    const design = template!.designPaths;
    for (const p of outline) expect(Math.abs(distanceToPaths(p, design) / margin - 1)).toBeLessThan(0.05);
    for (const p of design.flat()) expect(insidePolygon(p, outline)).toBe(true);
  });

  it("a design in separate pieces still gets one cut-out edge around all of them", () => {
    // Two 1 in squares 3 in apart.
    const { template } = buildTemplate({
      measurements: huge,
      design: designOf([[0, 0], [1, 0], [1, 1], [0, 1]], [[4, 0], [5, 0], [5, 1], [4, 1]]),
      placement: { width: 5 * IN, verticalOffset: 0, rotation: 0 },
    });

    const outline = template!.cutOutline;
    for (const p of template!.designPaths.flat()) expect(insidePolygon(p, outline)).toBe(true);
    const box = bboxOf(outline);
    near(box.minX, -2.5 * IN - MARGIN);
    near(box.maxX, 2.5 * IN + MARGIN);
  });

  it("a design that misses the pumpkin entirely gives no template", () => {
    const { template } = buildTemplate({
      measurements: sphereAround(20 * IN),
      design: designOf([[0, 0], [1, 0], [1, 1]]),
      placement: { width: 1 * IN, verticalOffset: 50 * IN, rotation: 0 },
    });

    expect(template).toBeNull();
  });
});
