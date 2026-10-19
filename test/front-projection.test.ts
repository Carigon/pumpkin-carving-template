import { describe, expect, it } from "vitest";
import { buildTemplate, type Design, type Placement } from "../src/core";

// A sphere: front arc = half the circumference.
const CIRCUMFERENCE = 60;
const R = CIRCUMFERENCE / (2 * Math.PI);
const sphere = { circumference: CIRCUMFERENCE, frontArc: CIRCUMFERENCE / 2, units: "in" as const };

/** Design whose bbox is the unit square around the origin, so width 2 maps design units 1:1 to inches. */
function unitDesign(points: [number, number][]): Design {
  return { paths: [points.map(([x, y]) => ({ x, y }))], bbox: { minX: -1, minY: -1, maxX: 1, maxY: 1 } };
}
/** Design with its bbox taken from its points; placing it at its bbox width maps it 1:1 to inches. */
function designOf(points: [number, number][]): Design {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    paths: [points.map(([x, y]) => ({ x, y }))],
    bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}
const oneToOne: Placement = { width: 2, verticalOffset: 0, rotation: 0 };

describe("front projection on a sphere", () => {
  it.each([0, 1, 3, 5, 8])(
    "a design point at horizontal offset %f lands at angle arcsin(x/R), R·arcsin(x/R) along the surface from the front",
    (x) => {
      const { design, warnings } = buildTemplate({
        measurements: sphere,
        design: unitDesign([[x, 0], [x, 0.001], [x - 0.001, 0]]),
        placement: oneToOne,
      });

      expect(warnings.filter((w) => w.kind === "outside-silhouette")).toEqual([]);
      const [p] = design!.paths[0].points;
      const point = p.surface!.point;
      const expectedAngle = Math.asin(x / R);

      expect(Math.hypot(...point)).toBeCloseTo(R, 6);
      expect(point[1]).toBeCloseTo(0, 6);
      expect(Math.atan2(point[0], point[2])).toBeCloseTo(expectedAngle, 6);
      // Great-circle distance from the front point (0, 0, R).
      expect(R * Math.acos(point[2] / R)).toBeCloseTo(R * expectedAngle, 5);
      expect(p.angleFromFront!).toBeCloseTo((expectedAngle * 180) / Math.PI, 4);
    },
  );
});

describe("limit warnings", () => {
  // On a sphere, a point at horizontal offset x sits asin(x/R) from the front; 60° is at x = R·sin 60°.
  const at = (deg: number) => R * Math.sin((deg * Math.PI) / 180);

  it.each([10, 45, 58])("a design reaching %i° from the front raises no limit warning", (deg) => {
    const { warnings } = buildTemplate({
      measurements: sphere,
      design: designOf([[-at(deg), -0.1], [at(deg), -0.1], [at(deg), 0.1], [-at(deg), 0.1]]),
      placement: { width: 2 * at(deg), verticalOffset: 0, rotation: 0 },
    });

    expect(warnings).toEqual([]);
  });

  it.each([62, 75, 85])("a design reaching %i° from the front raises the limit warning", (deg) => {
    const { warnings } = buildTemplate({
      measurements: sphere,
      design: designOf([[-at(deg), -0.1], [at(deg), -0.1], [0, 0.1]]),
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
      placement: { width: 2, verticalOffset: at(70), rotation: 0 },
    });

    expect(warnings.map((w) => w.kind)).toEqual(["past-front-limit"]);
  });
});

describe("points missing the silhouette", () => {
  it("are reported, counted, and left off the surface while the rest still project", () => {
    const { design, warnings } = buildTemplate({
      measurements: sphere,
      // A diamond whose left and right tips (x = ±12) fall outside the sphere's outline (radius R ≈ 9.55).
      design: designOf([[-12, 0], [0, -1], [12, 0], [0, 1]]),
      placement: { width: 24, verticalOffset: 0, rotation: 0 },
    });

    const silhouette = warnings.filter((w) => w.kind === "outside-silhouette");
    expect(silhouette).toHaveLength(1);
    expect(silhouette[0]).toMatchObject({ kind: "outside-silhouette", count: 2 });
    expect(silhouette[0].message).not.toBe("");

    const points = design!.paths[0].points;
    expect(points.map((p) => p.surface === null)).toEqual([true, false, true, false]);
    expect(points[0].angleFromFront).toBeNull();
  });

  it("a design inside the outline reports none", () => {
    const { warnings } = buildTemplate({
      measurements: sphere,
      design: designOf([[-2, -1], [2, -1], [2, 1], [-2, 1]]),
      placement: { width: 4, verticalOffset: 0, rotation: 0 },
    });

    expect(warnings).toEqual([]);
  });
});

describe("placement", () => {
  // Design in arbitrary units: bbox 100..300 wide, 0..50 high; corner (300, 50) is +100, +25 from center.
  const design: Design = {
    paths: [[{ x: 100, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 50 }]],
    bbox: { minX: 100, minY: 0, maxX: 300, maxY: 50 },
  };

  it("scales the design to its front-view width, centered, then moves it up by the vertical offset", () => {
    const { design: projected } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: 6, verticalOffset: 2, rotation: 0 },
    });

    const corner = projected!.paths[0].points[2];
    expect(corner.front.x).toBeCloseTo(3, 9);
    expect(corner.front.y).toBeCloseTo(0.75 + 2, 9);
    // Front projection keeps the front-view position: the surface point is straight behind it.
    expect(corner.surface!.point[0]).toBeCloseTo(3, 9);
    expect(corner.surface!.point[1]).toBeCloseTo(2.75, 9);
  });

  it("rotates counterclockwise about the design's center", () => {
    const { design: projected } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: 6, verticalOffset: 1, rotation: 90 },
    });

    const corner = projected!.paths[0].points[2];
    expect(corner.front.x).toBeCloseTo(-0.75, 9);
    expect(corner.front.y).toBeCloseTo(3 + 1, 9);
  });
});
