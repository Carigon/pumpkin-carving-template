import { describe, expect, it } from "vitest";
import { buildTemplate, type Design, type Placement } from "../src/core";

/** Millimetres per inch. */
const IN = 25.4;
// A sphere: height = circumference / π, widest at mid-height.
const CIRCUMFERENCE = 60 * IN;
const R = CIRCUMFERENCE / (2 * Math.PI);
/** The surface is a triangle mesh within 0.25 mm of the smooth shape. */
const MESH_TOLERANCE = 0.25;
const plainSphere = { height: 2 * R, rings: [{ circumference: CIRCUMFERENCE, position: 0.5 }] };
/** The same sphere measured with more tape rings, a quarter and three quarters of the way up. */
const ringedSphere = {
  ...plainSphere,
  rings: [0.5, 0.25, 0.75].map((position) => ({
    position,
    circumference: 2 * Math.PI * Math.sqrt(R ** 2 - (2 * R * (position - 0.5)) ** 2),
  })),
};

/** Design whose bbox is the unit square around the origin, so width 2 in maps design units 1:1 to inches. */
function unitDesign(points: [number, number][]): Design {
  return { paths: [points.map(([x, y]) => ({ x, y }))], bbox: { minX: -1, minY: -1, maxX: 1, maxY: 1 } };
}
/** Design with its bbox taken from its points; placing it at its bbox width maps it 1:1 to mm (at IN times that, to inches). */
function designOf(points: [number, number][]): Design {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    paths: [points.map(([x, y]) => ({ x, y }))],
    bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}
const oneToOne: Placement = { width: 2 * IN, verticalOffset: 0, rotation: 0 };

describe.each([
  ["given as one circumference", plainSphere],
  ["given as rings", ringedSphere],
])("sphere %s", (_name, sphere) => {
  describe("front projection on a sphere", () => {
    it.each([0, 1, 3, 5, 8])(
      "a design point at horizontal offset %f in lands at angle arcsin(x/R), R·arcsin(x/R) along the surface from the front",
      (inches) => {
        const x = inches * IN;
        const { design, warnings } = buildTemplate({
          measurements: sphere,
          design: unitDesign([[inches, 0], [inches, 0.001], [inches - 0.001, 0]]),
          placement: oneToOne,
        });

        expect(warnings.filter((w) => w.kind === "outside-silhouette")).toEqual([]);
        const [p] = design!.paths[0].points;
        const point = p.surface!.point;
        const expectedAngle = Math.asin(x / R);
        // Off by up to the mesh tolerance along the surface's normal, which turns the angle by up to tan(angle) times that.
        const angleTolerance = (2 * MESH_TOLERANCE) / R;

        expect(Math.abs(Math.hypot(...point) - R)).toBeLessThan(MESH_TOLERANCE);
        expect(point[0]).toBeCloseTo(x, 9);
        expect(point[1]).toBeCloseTo(0, 9);
        expect(Math.abs(Math.atan2(point[0], point[2]) - expectedAngle)).toBeLessThan(angleTolerance);
        // Great-circle distance from the front point (0, 0, R).
        expect(Math.abs(R * Math.atan2(Math.hypot(point[0], point[1]), point[2]) - R * expectedAngle)).toBeLessThan(2 * MESH_TOLERANCE);
        expect(Math.abs(p.angleFromFront! - (expectedAngle * 180) / Math.PI)).toBeLessThan((angleTolerance * 180) / Math.PI);
      },
    );
  });

  describe("limit warnings", () => {
    // On a sphere, a point at horizontal offset x sits asin(x/R) from the front; 60° is at x = R·sin 60°.
    const at = (deg: number) => R * Math.sin((deg * Math.PI) / 180);

    it.each([10, 45, 58])("a design reaching %i° from the front raises no limit warning", (deg) => {
      const { warnings } = buildTemplate({
        measurements: sphere,
        design: designOf([[-at(deg), -0.1 * IN], [at(deg), -0.1 * IN], [at(deg), 0.1 * IN], [-at(deg), 0.1 * IN]]),
        placement: { width: 2 * at(deg), verticalOffset: 0, rotation: 0 },
      });

      expect(warnings).toEqual([]);
    });

    it.each([62, 75, 85])("a design reaching %i° from the front raises the limit warning", (deg) => {
      const { warnings } = buildTemplate({
        measurements: sphere,
        design: designOf([[-at(deg), -0.1 * IN], [at(deg), -0.1 * IN], [0, 0.1 * IN]]),
        placement: { width: 2 * at(deg), verticalOffset: 0, rotation: 0 },
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ kind: "past-front-limit" });
      expect(warnings[0].message).not.toBe("");
    });

    it("measures the limit by where the surface faces, so it also applies vertically", () => {
      const { warnings } = buildTemplate({
        measurements: sphere,
        design: unitDesign([[0, 0], [0.01, 0], [0, 0.01]]),
        placement: { width: 2 * IN, verticalOffset: at(70), rotation: 0 },
      });

      expect(warnings.map((w) => w.kind)).toEqual(["past-front-limit"]);
    });
  });

  describe("the projected line, for drawing", () => {
    // A triangle 12 in wide on a sphere of radius ≈ 9.55 in: a straight chord between its corners would sink about 2 in.
    const triangle = designOf([[-6, -4], [6, -4], [0, 5]]);
    const placed = { width: 12 * IN, verticalOffset: 0, rotation: 0 };

    it("follows the surface along long straight edges", () => {
      const { design } = buildTemplate({ measurements: sphere, design: triangle, placement: placed });

      const line = design!.paths[0].line;
      for (let i = 0; i < line.length; i++) {
        const a = line[i].surface!.point, b = line[(i + 1) % line.length].surface!.point;
        const middle = [0, 1, 2].map((k) => (a[k] + b[k]) / 2);
        // Each chord's middle stays within a hundredth of an inch (plus the mesh's own tolerance) of the skin.
        expect(R - Math.hypot(...middle)).toBeLessThan(0.01 * IN + MESH_TOLERANCE);
      }
    });

    it("passes through the design's own points, in order", () => {
      const { design } = buildTemplate({ measurements: sphere, design: triangle, placement: placed });

      const { points, line } = design!.paths[0];
      const own = line.filter((p) => points.some((q) => q.front.x === p.front.x && q.front.y === p.front.y));
      expect(own).toEqual(points);
    });
  });

  describe("points missing the silhouette", () => {
    it("are reported, counted, and left off the surface while the rest still project", () => {
      const { design, warnings } = buildTemplate({
        measurements: sphere,
        // A diamond whose left and right tips (x = ±12 in) fall outside the sphere's profile (radius R ≈ 9.55 in).
        design: designOf([[-12, 0], [0, -1], [12, 0], [0, 1]]),
        placement: { width: 24 * IN, verticalOffset: 0, rotation: 0 },
      });

      const silhouette = warnings.filter((w) => w.kind === "outside-silhouette");
      expect(silhouette).toHaveLength(1);
      expect(silhouette[0]).toMatchObject({ kind: "outside-silhouette", count: 2 });
      expect(silhouette[0].message).not.toBe("");

      const points = design!.paths[0].points;
      expect(points.map((p) => p.surface === null)).toEqual([true, false, true, false]);
      expect(points[0].angleFromFront).toBeNull();
      // The drawn line misses along the stretches past the profile too, but the count stays with the design's own points.
      expect(design!.paths[0].line.filter((p) => p.surface === null).length).toBeGreaterThan(2);
    });

    it("a design inside the outline reports none", () => {
      const { warnings } = buildTemplate({
        measurements: sphere,
        design: designOf([[-2, -1], [2, -1], [2, 1], [-2, 1]]),
        placement: { width: 4 * IN, verticalOffset: 0, rotation: 0 },
      });

      expect(warnings).toEqual([]);
    });
  });
});

describe("placement", () => {
  const sphere = plainSphere;
  it.each([0, -3 * IN, Number.NaN])("a front-view width of %f mm projects nothing", (width) => {
    const { surface, design, warnings } = buildTemplate({
      measurements: sphere,
      design: designOf([[-1, -1], [1, -1], [0, 1]]),
      placement: { width, verticalOffset: 0, rotation: 0 },
    });

    expect(surface).not.toBeNull();
    expect(design).toBeNull();
    expect(warnings).toEqual([]);
  });

  // Design in arbitrary units: bbox 100..300 wide, 0..50 high; corner (300, 50) is +100, +25 from center.
  const design: Design = {
    paths: [[{ x: 100, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 50 }]],
    bbox: { minX: 100, minY: 0, maxX: 300, maxY: 50 },
  };

  it("scales the design to its front-view width, centered, then moves it up by the vertical offset", () => {
    const { design: projected } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: 6 * IN, verticalOffset: 2 * IN, rotation: 0 },
    });

    const corner = projected!.paths[0].points[2];
    expect(corner.front.x).toBeCloseTo(3 * IN, 9);
    expect(corner.front.y).toBeCloseTo((0.75 + 2) * IN, 9);
    // Front projection keeps the front-view position: the surface point is straight behind it.
    expect(corner.surface!.point[0]).toBeCloseTo(3 * IN, 9);
    expect(corner.surface!.point[1]).toBeCloseTo(2.75 * IN, 9);
  });

  it("rotates counterclockwise about the design's center", () => {
    const { design: projected } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: 6 * IN, verticalOffset: 1 * IN, rotation: 90 },
    });

    const corner = projected!.paths[0].points[2];
    expect(corner.front.x).toBeCloseTo(-0.75 * IN, 9);
    expect(corner.front.y).toBeCloseTo((3 + 1) * IN, 9);
  });
});
