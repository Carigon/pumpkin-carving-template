import { describe, expect, it } from "vitest";
import { buildTemplate, type FlatTemplate, type Point2 } from "../src/core";
import { referenceCases } from "./analytic-reference/cases";
import reference from "./analytic-reference/templates.json";

/**
 * Templates the analytic surface (the smooth revolved shape, flattened through its (u, v) chart) produced for
 * `referenceCases`, recorded before flattening moved onto the mesh. Points are [x, y] on paper, in the units the case
 * was measured in back then (inches or cm): scale them by the case's mm per unit.
 */
type Recorded = {
  designPaths: [number, number][][];
  cutOutline: [number, number][];
  /** Largest stretch of a triangle on the paper (inside the cut-out edge), and the RMS over the whole patch. */
  stretch: { maxOnPaper: number; rms: number };
};
const recorded = reference as unknown as Record<string, Recorded>;

/**
 * How far design paths and the cut-out edge may move from the analytic template: 1 mm. The analytic
 * template turned its paper upright through its (u, v) chart, which is off by a fraction of a degree high up on a
 * pumpkin (the chart's scale changes with height), so about half of this is the reference's own error.
 */
const TOLERANCE_MM = 1;

/** A recorded line in mm, from its points in units `mmPerUnit` mm long. */
const toPoints = (line: [number, number][], mmPerUnit: number): Point2[] => line.map(([x, y]) => ({ x: x * mmPerUnit, y: y * mmPerUnit }));

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function distanceToLine(p: Point2, line: Point2[], closed: boolean): number {
  let best = Infinity;
  const segments = closed ? line.length : line.length - 1;
  for (let i = 0; i < segments; i++) best = Math.min(best, distanceToSegment(p, line[i], line[(i + 1) % line.length]));
  return best;
}

/** Furthest either line strays from the other (symmetric Hausdorff distance, measured at the vertices). */
function apart(a: Point2[], b: Point2[], closed: boolean): number {
  return Math.max(...a.map((p) => distanceToLine(p, b, closed)), ...b.map((p) => distanceToLine(p, a, closed)));
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

/** Largest stretch of a triangle whose middle is on the paper. */
function maxOnPaper({ stretch, cutOutline }: FlatTemplate): number {
  let max = 0;
  stretch.triangles.forEach((tri, t) => {
    const [a, b, c] = tri.map((v) => stretch.flat[v]);
    if (insidePolygon({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, cutOutline)) max = Math.max(max, stretch.values[t]);
  });
  return max;
}

describe.each(referenceCases)("the template on the mesh for %s", (name, input, mmPerUnit) => {
  const analytic = recorded[name];
  const { template } = buildTemplate(input);

  it("has the analytic template's design paths, within 1 mm", () => {
    expect(template!.designPaths).toHaveLength(analytic.designPaths.length);
    template!.designPaths.forEach((path, i) => {
      expect(apart(path, toPoints(analytic.designPaths[i], mmPerUnit), true), `path ${i}`).toBeLessThan(TOLERANCE_MM);
    });
  });

  it("has the analytic template's cut-out edge, within 1 mm", () => {
    expect(apart(template!.cutOutline, toPoints(analytic.cutOutline, mmPerUnit), true)).toBeLessThan(TOLERANCE_MM);
  });

  it("has the analytic template's stretch", () => {
    // Over the whole patch, to within 5 %.
    expect(Math.abs(template!.stretch.rms / analytic.stretch.rms - 1)).toBeLessThan(0.05);
    // The worst on the paper matches to within 5 %. (Outside the cut-out edge the patch's ragged border stretches
    // more, but that paper is cut off.)
    expect(Math.abs(maxOnPaper(template!) / analytic.stretch.maxOnPaper - 1)).toBeLessThan(0.05);
  });
});
