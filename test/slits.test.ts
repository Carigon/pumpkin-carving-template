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

/** How far a slit runs in from the cut-out edge: the distance from its deepest point (the tip) to the edge. */
const depthIn = (slit: Point2[], outline: Point2[]) => Math.max(...slit.map((p) => distanceToOutline(p, outline)));

describe("slits", () => {
  const CIRCUMFERENCE = 60;
  const R = CIRCUMFERENCE / (2 * Math.PI);
  const sphere = { height: 2 * R, rings: [{ circumference: CIRCUMFERENCE, position: 0.5 }], units: "in" as const };
  const deg = Math.PI / 180;
  const at = (angle: number, heading: number): [number, number] => [
    R * Math.sin(angle) * Math.cos(heading),
    R * Math.sin(angle) * Math.sin(heading),
  ];
  /** A small round carve area about 0.6 in across, `angle` from the front along `heading`. */
  const dot = (angle: number, heading: number): [number, number][] => {
    const [cx, cy] = at(angle, heading);
    return Array.from({ length: 12 }, (_, k) => [cx + 0.3 * Math.cos((k * Math.PI) / 6), cy + 0.3 * Math.sin((k * Math.PI) / 6)]);
  };
  /**
   * A ring of dots `angle` from the front plus one in the middle, like the features of a face: blank paper
   * between them, and one cut-out edge around them all. Slits belong at headings 90°, 135°, ... (every 45°).
   */
  const ring = (angle: number, headings: number[]) => {
    const design = designOf(dot(0, 0), ...headings.map((h) => dot(angle * deg, h * deg)));
    return { design, placement: { width: design.bbox.maxX - design.bbox.minX, verticalOffset: 0, rotation: 0 } };
  };
  /** Dots between the slit headings: nothing in the slits' way. */
  const between = [0, 45, 90, 135, 180, 225, 270, 315].map((h) => h + 22.5);

  it("by default, 8 slits run in from the cut-out edge to the default depth (1 in)", () => {
    const { template, warnings } = buildTemplate({ measurements: sphere, ...ring(30, between) });

    expect(template!.slits).toHaveLength(8);
    for (const slit of template!.slits) {
      // Starts and ends on the cut-out edge...
      expect(distanceToOutline(slit[0], template!.cutOutline)).toBeLessThan(0.05);
      expect(distanceToOutline(slit[slit.length - 1], template!.cutOutline)).toBeLessThan(0.05);
      // ...and reaches about the set depth inward.
      expect(depthIn(slit, template!.cutOutline)).toBeGreaterThan(0.85);
      expect(depthIn(slit, template!.cutOutline)).toBeLessThan(1.15);
    }
    expect(warnings).toEqual([]);
  });

  it.each([
    ["dots right where the slits would go", [90, 135, 180, 225, 270, 315, 0, 45]],
    ["dots close on both sides of them", [80, 100, 125, 145, 170, 190, 215, 235, 260, 280, 305, 325, 350, 10, 35, 55]],
  ])("with %s, 2 in slits move sideways or bend into the blank paper, reach their depth and never cross the design", (_, headings) => {
    const { template, warnings } = buildTemplate({ measurements: sphere, ...ring(30, headings), slits: { count: 8, depth: 2 } });

    expect(template!.slits).toHaveLength(8);
    for (const [i, slit] of template!.slits.entries()) {
      expect(crossesAny(slit, template!.designPaths), `slit ${i}`).toBe(false);
      expect(depthIn(slit, template!.cutOutline), `slit ${i}`).toBeGreaterThan(2 * 0.85);
    }
    expect(warnings).toEqual([]);
  });

  it("a slit bends around a design line in its way rather than stopping at it", () => {
    // A bar across the slit line toward the stem, wider than the slits may shift sideways,
    // with blank paper beyond it: the slit has to go around it to reach its depth.
    const bar: [number, number][] = [[-2.4, 2.6], [2.4, 2.6], [2.4, 2.9], [-2.4, 2.9]];
    const design = designOf(dot(0, 0), ...between.map((h) => dot(30 * deg, h * deg)), bar);
    const { template, warnings } = buildTemplate({
      measurements: sphere,
      design,
      placement: { width: design.bbox.maxX - design.bbox.minX, verticalOffset: 0, rotation: 0 },
      slits: { count: 1, depth: 2.5 },
    });

    const [slit] = template!.slits;
    expect(crossesAny(slit, template!.designPaths)).toBe(false);
    // It starts above the bar and gets past it.
    const barBottom = Math.min(...template!.designPaths[template!.designPaths.length - 1].map((p) => p.y));
    expect(slit[0].y).toBeGreaterThan(barBottom);
    expect(Math.min(...slit.map((p) => p.y))).toBeLessThan(barBottom);
    expect(depthIn(slit, template!.cutOutline)).toBeGreaterThan(2.5 * 0.85);
    expect(warnings).toEqual([]);
  });

  describe("when the design leaves no blank paper deep enough", () => {
    // A solid disc reaching 45° from the front: the only blank paper is the 3/4 in margin around it.
    const disc = designOf(Array.from({ length: 64 }, (_, k) => at(45 * deg, (k * 2 * Math.PI) / 64)));
    const placement = { width: disc.bbox.maxX - disc.bbox.minX, verticalOffset: 0, rotation: 0 };

    it("slits are cut short at the design and a warning is raised when that's well short of their depth", () => {
      const { template, warnings } = buildTemplate({ measurements: sphere, design: disc, placement, slits: { count: 8, depth: 2 } });

      const shortened = warnings.filter((w) => w.kind === "slit-shortened");
      expect(shortened).toHaveLength(1);
      expect(shortened[0]).toMatchObject({ kind: "slit-shortened", count: 8 });
      expect(shortened[0].message).not.toBe("");
      expect(template!.slits).toHaveLength(8);
      for (const slit of template!.slits) {
        expect(crossesAny(slit, template!.designPaths)).toBe(false);
        expect(depthIn(slit, template!.cutOutline)).toBeLessThan(0.75);
      }
    });

    it("the default slits fit in the margin without a warning", () => {
      const { template, warnings } = buildTemplate({ measurements: sphere, design: disc, placement });

      expect(template!.slits).toHaveLength(8);
      for (const slit of template!.slits) expect(crossesAny(slit, template!.designPaths)).toBe(false);
      expect(warnings).toEqual([]);
    });
  });

  it("a design spanning 90° on a sphere stays within the stretch limit with the default slits, and less than without", () => {
    const { template: slit } = buildTemplate({ measurements: sphere, ...ring(45, between) });
    const { template: plain } = buildTemplate({ measurements: sphere, ...ring(45, between), slits: { count: 0, depth: 0 } });

    // Limits: 3 % on average, 20 % at worst (measured: about 2.8 % and 14 %; without slits 4 % and 15 %).
    // The worst spots are the slit tips, where the opening paper pulls hardest.
    expect(slit!.stretch.rms).toBeLessThan(0.03);
    expect(slit!.stretch.max).toBeLessThan(0.2);
    expect(slit!.stretch.rms).toBeLessThan(0.8 * plain!.stretch.rms);
  });

  it("fewer, shallower slits can be chosen; zero means none", () => {
    const { template: few } = buildTemplate({ measurements: sphere, ...ring(30, between), slits: { count: 3, depth: 0.5 } });
    const { template: none } = buildTemplate({ measurements: sphere, ...ring(30, between), slits: { count: 0, depth: 1 } });

    expect(few!.slits).toHaveLength(3);
    for (const slit of few!.slits) expect(depthIn(slit, few!.cutOutline)).toBeCloseTo(0.5, 0);
    expect(none!.slits).toEqual([]);
  });
});
