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

/** Distance from p to the boundary of a closed polygon. */
function distanceToOutline(p: Point2, outline: Point2[]): number {
  let best = Infinity;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    best = Math.min(best, distanceToSegment(p, a, b));
  });
  return best;
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const side = (p: Point2, q: Point2, r: Point2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** Does an open polyline touch any closed path? */
function crossesAny(slit: Point2[], paths: Point2[][]): boolean {
  for (let i = 0; i + 1 < slit.length; i++) {
    for (const path of paths) {
      for (let j = 0; j < path.length; j++) {
        if (segmentsCross(slit[i], slit[i + 1], path[j], path[(j + 1) % path.length])) return true;
      }
    }
  }
  return false;
}

/** How far a slit runs in from the cut-out edge: from where it starts to its farthest point (the tip). */
const reach = (slit: Point2[]) => Math.max(...slit.map((p) => Math.hypot(p.x - slit[0].x, p.y - slit[0].y)));

describe("slits", () => {
  const CIRCUMFERENCE = 60;
  const R = CIRCUMFERENCE / (2 * Math.PI);
  const sphere = { circumference: CIRCUMFERENCE, frontArc: CIRCUMFERENCE / 2, units: "in" as const };
  const deg = Math.PI / 180;
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
  /** Spokes reaching 45° from the front: the design spans 90° of the sphere. */
  const spokes = (...headings: number[]) => {
    const design = designOf(...headings.map((h) => spoke(5 * deg, 45 * deg, h * deg)));
    return { design, placement: { width: design.bbox.maxX - design.bbox.minX, verticalOffset: 0, rotation: 0 } };
  };

  it("by default, 8 slits run in from the cut-out edge to the default depth (2 in)", () => {
    const { template, warnings } = buildTemplate({ measurements: sphere, ...spokes(0, 90, 180, 270) });

    expect(template!.slits).toHaveLength(8);
    for (const slit of template!.slits) {
      // Starts on the cut-out edge...
      expect(distanceToOutline(slit[0], template!.cutOutline)).toBeLessThan(0.05);
      expect(distanceToOutline(slit[slit.length - 1], template!.cutOutline)).toBeLessThan(0.05);
      // ...and reaches about the set depth inward.
      expect(reach(slit)).toBeGreaterThan(2 * 0.85);
      expect(reach(slit)).toBeLessThan(2 * 1.15);
    }
    expect(warnings.filter((w) => w.kind === "slit-shortened")).toHaveLength(0);
  });

  it.each([
    ["spokes right where the slits would go", [90, 135, 180, 225, 270, 315, 0, 45]],
    ["spokes just beside them", [80, 100, 170, 190, 260, 280, 350, 10]],
  ])("with %s, the slits move into the blank paper and never cross the design", (_, headings) => {
    const { template, warnings } = buildTemplate({ measurements: sphere, ...spokes(...headings) });

    expect(template!.slits).toHaveLength(8);
    for (const [i, slit] of template!.slits.entries()) {
      expect(crossesAny(slit, template!.designPaths), `slit ${i}`).toBe(false);
      expect(reach(slit)).toBeGreaterThan(2 * 0.85);
    }
    expect(warnings.filter((w) => w.kind === "slit-shortened")).toHaveLength(0);
  });

  it("when the design leaves no blank paper for a slit, the slit is shortened and a warning is raised", () => {
    // A solid disc reaching 45° from the front: the only blank paper is the 3/4 in margin around it.
    const disc = Array.from({ length: 64 }, (_, k) => at(45 * deg, (k * 2 * Math.PI) / 64));
    const design = designOf(disc);
    const { template, warnings } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: design.bbox.maxX - design.bbox.minX, verticalOffset: 0, rotation: 0 },
    });

    const shortened = warnings.filter((w) => w.kind === "slit-shortened");
    expect(shortened).toHaveLength(1);
    expect(shortened[0]).toMatchObject({ kind: "slit-shortened", count: 8 });
    expect(shortened[0].message).not.toBe("");
    expect(template!.slits).toHaveLength(8);
    for (const slit of template!.slits) {
      expect(crossesAny(slit, template!.designPaths)).toBe(false);
      expect(reach(slit)).toBeLessThan(0.75);
    }
  });

  it("a design spanning 90° on a sphere stays within the stretch limit with the default slits, and less than without", () => {
    const { template: slit } = buildTemplate({ measurements: sphere, ...spokes(0, 90, 180, 270) });
    const { template: plain } = buildTemplate({ measurements: sphere, ...spokes(0, 90, 180, 270), slits: { count: 0, depth: 0 } });

    // Limits: 3 % on average, 10 % at worst (measured: about 2.5 % and 7.6 %; without slits 3.6 % and 8.2 %).
    expect(slit!.stretch.rms).toBeLessThan(0.03);
    expect(slit!.stretch.max).toBeLessThan(0.1);
    expect(slit!.stretch.rms).toBeLessThan(0.8 * plain!.stretch.rms);
  });

  it("fewer, shallower slits can be chosen; zero means none", () => {
    const { template: few } = buildTemplate({ measurements: sphere, ...spokes(0, 90, 180, 270), slits: { count: 3, depth: 1 } });
    const { template: none } = buildTemplate({ measurements: sphere, ...spokes(0, 90, 180, 270), slits: { count: 0, depth: 1 } });

    expect(few!.slits).toHaveLength(3);
    for (const slit of few!.slits) expect(reach(slit)).toBeCloseTo(1, 0);
    expect(none!.slits).toEqual([]);
  });
});
