import { describe, expect, it } from "vitest";
import { buildTemplate, type Point2, type TemplateInput } from "../src/core";
import even from "./even-spacing.json";
import { between, circle, designOf, dots, evenSpacingCases, IN, onSphere, paperStrain, placed, ring, sphere, squat, tapering } from "./slit-cases";

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Distance from p to the boundary of a closed polygon. */
function distanceToOutline(p: Point2, outline: Point2[]): number {
  return Math.min(...outline.map((a, i) => distanceToSegment(p, a, outline[(i + 1) % outline.length])));
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

/** Least distance between two open polylines that don't cross. */
function apart(a: Point2[], b: Point2[]): number {
  const toLine = (p: Point2, line: Point2[]) => Math.min(...line.slice(1).map((q, i) => distanceToSegment(p, line[i], q)));
  return Math.min(...a.map((p) => toLine(p, b)), ...b.map((p) => toLine(p, a)));
}

/** How sharply a polyline turns at b, in degrees. */
function turn(a: Point2, b: Point2, c: Point2): number {
  const d = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
  return ((d > Math.PI ? 2 * Math.PI - d : d) * 180) / Math.PI;
}

/** How far a slit runs in from the cut-out edge: the distance from its deepest point (the tip) to the edge. */
const depthIn = (slit: Point2[], outline: Point2[]) => Math.max(...slit.map((p) => distanceToOutline(p, outline)));
/** Where a slit opens on the cut-out edge: halfway between its two ends. */
const mouth = (slit: Point2[]): Point2 => ({ x: (slit[0].x + slit.at(-1)!.x) / 2, y: (slit[0].y + slit.at(-1)!.y) / 2 });

/** Placing slits runs many flattening solves. */
const SLOW = 60_000;
const deg = Math.PI / 180;

describe("slits", () => {
  it(
    "by default (Auto), slits are added until the paper stretches at most 3 % nearly everywhere",
    () => {
      // Dots 37° from the front: without slits, 5 % of the paper stretches more than 3 %.
      const input = { measurements: sphere, ...ring(37, between) };
      const { template, warnings } = buildTemplate(input);
      const { template: plain } = buildTemplate({ ...input, slits: { count: 0, depth: 2 * IN } });

      expect(paperStrain(plain!).p95).toBeGreaterThan(0.035);
      expect(template!.slits.length).toBeGreaterThan(0);
      // The builder measures the paper on its own layout of it, which differs a little from the finished paper.
      expect(paperStrain(template!).p95).toBeLessThan(0.0305);
      expect(warnings).toEqual([]);
    },
    SLOW,
  );

  it("Auto adds no slits where the paper fits well enough without them", () => {
    const { template, warnings } = buildTemplate({ measurements: sphere, ...ring(30, between) });

    expect(paperStrain(template!).p95).toBeLessThan(0.03);
    expect(template!.slits).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it(
    "on a design placed high on a pumpkin that tapers toward the stem, the slits go toward the stem, where the paper stretches most",
    () => {
      const input = { measurements: tapering, ...placed(dots(0), 5.8 * IN, 2 * IN) };
      const { template: auto } = buildTemplate(input);
      const { template: four } = buildTemplate({ ...input, slits: { count: 4, depth: 2 * IN } });

      expect(auto!.slits.length).toBeGreaterThan(0);
      for (const slit of auto!.slits) expect(mouth(slit).y).toBeGreaterThan(0);
      expect(four!.slits).toHaveLength(4);
      expect(four!.slits.filter((slit) => mouth(slit).y > 0).length).toBeGreaterThanOrEqual(3);
    },
    SLOW,
  );

  it(
    "a set count is respected; zero means none",
    () => {
      const input = { measurements: sphere, ...ring(30, between) };
      const { template: three, warnings } = buildTemplate({ ...input, slits: { count: 3, depth: 2 * IN } });
      const { template: none } = buildTemplate({ ...input, slits: { count: 0, depth: 2 * IN } });

      expect(three!.slits).toHaveLength(3);
      expect(warnings).toEqual([]);
      expect(none!.slits).toEqual([]);
    },
    SLOW,
  );

  it(
    "slits run in from the cut-out edge as deep as the blank paper allows, up to the max depth (2 in by default)",
    () => {
      const input = { measurements: sphere, ...ring(30, between) };
      const { template: deep } = buildTemplate({ ...input, slits: { count: 6, depth: 2 * IN } });
      const { template: shallow } = buildTemplate({ ...input, slits: { count: 6, depth: 1.2 * IN } });

      for (const [i, slit] of deep!.slits.entries()) {
        // Starts and ends on the cut-out edge...
        expect(distanceToOutline(slit[0], deep!.cutOutline), `slit ${i}`).toBeLessThan(0.05 * IN);
        expect(distanceToOutline(slit.at(-1)!, deep!.cutOutline), `slit ${i}`).toBeLessThan(0.05 * IN);
        // ...and, with blank paper all the way, reaches the max depth.
        expect(depthIn(slit, deep!.cutOutline), `slit ${i}`).toBeGreaterThan(2 * IN * 0.9);
        expect(depthIn(slit, deep!.cutOutline), `slit ${i}`).toBeLessThan(2 * IN * 1.07);
      }
      expect(shallow!.slits).toHaveLength(6);
      // To within 0.05 in.
      for (const slit of shallow!.slits) expect(Math.abs(depthIn(slit, shallow!.cutOutline) - 1.2 * IN)).toBeLessThan(0.05 * IN);
    },
    SLOW,
  );

  it.each<[string, TemplateInput]>([
    ["dots on a sphere", { measurements: sphere, ...ring(30, [90, 135, 180, 225, 270, 315, 0, 45]), slits: { count: 8, depth: 2 * IN } }],
    ["dots on a squat pumpkin", { measurements: squat, ...placed(dots(90), 5.8 * IN), slits: { count: 8, depth: 2 * IN } }],
    ["dots high on a tapering pumpkin", { measurements: tapering, ...placed(dots(0), 5.8 * IN, 2 * IN), slits: { count: 6, depth: 2 * IN } }],
  ])(
    "with %s, slits steer around the design, never cross it and stay about 1 in apart",
    (_, input) => {
      const { template } = buildTemplate(input);

      expect(template!.slits.length).toBeGreaterThan(3);
      for (const [i, slit] of template!.slits.entries()) {
        expect(crossesAny(slit, template!.designPaths), `slit ${i}`).toBe(false);
        for (const [j, other] of template!.slits.slice(i + 1).entries()) expect(apart(slit, other), `slits ${i}, ${i + j + 1}`).toBeGreaterThan(0.85 * IN);
      }
    },
    SLOW,
  );

  it(
    "slits with blank paper ahead run straight in and back out, not staircased along the mesh",
    () => {
      const { template } = buildTemplate({ measurements: sphere, ...ring(30, [90, 135, 180, 225, 270, 315, 0, 45]), slits: { count: 8, depth: 2 * IN } });

      for (const [i, slit] of template!.slits.entries()) {
        const tip = slit.reduce((deepest, p, k) => (distanceToOutline(p, template!.cutOutline) > distanceToOutline(slit[deepest], template!.cutOutline) ? k : deepest), 0);
        // Away from the tip, where the slit turns back, no bend sharper than 20°.
        for (let k = 1; k + 1 < slit.length; k++) {
          if (k !== tip) expect(turn(slit[k - 1], slit[k], slit[k + 1]), `slit ${i} at ${k}`).toBeLessThan(20);
        }
      }
    },
    SLOW,
  );

  describe("when the design leaves no blank paper deeper than the margin", () => {
    // An oval 5 in wide on a squat pumpkin, and a disc reaching 45° from the front of a sphere: solid carve areas,
    // so the only blank paper is the 3/4 in margin around them.
    const oval = designOf(Array.from({ length: 48 }, (_, k): [number, number] => [1.5 * Math.cos((2 * Math.PI * k) / 48), Math.sin((2 * Math.PI * k) / 48)]));
    const solidOval: TemplateInput = { measurements: { height: 8 * IN, rings: [{ position: 0.5, circumference: 34 * IN }] }, ...placed(oval, 5 * IN, 0.5 * IN) };
    const disc = designOf(Array.from({ length: 64 }, (_, k) => onSphere(45 * deg, (k * 2 * Math.PI) / 64)));
    const solidDisc: TemplateInput = { measurements: sphere, ...placed(disc, disc.bbox.maxX - disc.bbox.minX) };

    it.each<[string, TemplateInput["slits"]]>([
      ["Auto", undefined],
      ["a set count", { count: 8, depth: 2 * IN }],
    ])(
      "with %s, slits run through most of the margin and relieve the stretch",
      (_, slits) => {
        const { template, warnings } = buildTemplate({ ...solidOval, slits });
        const { template: plain } = buildTemplate({ ...solidOval, slits: { count: 0, depth: 2 * IN } });

        expect(template!.slits.length).toBeGreaterThanOrEqual(6);
        for (const slit of template!.slits) {
          expect(crossesAny(slit, template!.designPaths)).toBe(false);
          // About 0.65 in: the margin less the slit's clearance from the design.
          expect(depthIn(slit, template!.cutOutline)).toBeGreaterThan(0.5 * IN);
          expect(depthIn(slit, template!.cutOutline)).toBeLessThan(0.75 * IN);
        }
        expect(paperStrain(template!).rms).toBeLessThan(0.75 * paperStrain(plain!).rms);
        // A set count that fits says nothing; Auto, stopping short of 3 % (about 3.4 % here), says so.
        expect(warnings).toMatchObject(slits ? [] : [{ kind: "slit-limit" }]);
      },
      SLOW,
    );

    it(
      "a set count is placed even where it barely helps; Auto then places none and says the paper still stretches more than 3 %",
      () => {
        const { template: set, warnings } = buildTemplate({ ...solidDisc, slits: { count: 8, depth: 2 * IN } });
        const { template: auto, warnings: autoWarnings } = buildTemplate(solidDisc);

        expect(set!.slits).toHaveLength(8);
        expect(warnings).toEqual([]);
        expect(paperStrain(set!).rms).toBeLessThan(paperStrain(auto!).rms);
        expect(auto!.slits).toEqual([]);
        expect(paperStrain(auto!).p95).toBeGreaterThan(0.03);
        expect(autoWarnings).toMatchObject([{ kind: "slit-limit" }]);
        expect(autoWarnings[0].message).toMatch(/smaller design|wider margin/);
      },
      SLOW,
    );

    it("Auto says so when no slit fits and the paper still stretches more than 3 %", () => {
      const { template, warnings } = buildTemplate({ ...solidDisc, slits: { count: "auto", depth: 0 } });

      expect(template!.slits).toEqual([]);
      expect(paperStrain(template!).p95).toBeGreaterThan(0.03);
      expect(warnings).toMatchObject([{ kind: "slit-limit" }]);
      expect(warnings[0].message).not.toBe("");
    });
  });

  it(
    "a set count that doesn't fit places what fits and says how many",
    () => {
      // A dot 1 in across: its cut-out edge is about 8 in around, room for only a few slits 1 in apart.
      const { template, warnings } = buildTemplate({ measurements: sphere, ...placed(designOf(circle(0, 0, 0.5)), 1 * IN), slits: { count: 12, depth: 2 * IN } });

      expect(template!.slits.length).toBeGreaterThan(0);
      expect(template!.slits.length).toBeLessThan(12);
      expect(warnings).toMatchObject([{ kind: "slits-dont-fit", count: template!.slits.length }]);
      expect(warnings[0].message).not.toBe("");
    },
    SLOW,
  );

  it(
    "a design spanning 90° on a sphere stays within the stretch limits with the default slits, far less than without",
    () => {
      const input = { measurements: sphere, ...ring(45, between) };
      const { template: slit } = buildTemplate(input);
      const { template: plain } = buildTemplate({ ...input, slits: { count: 0, depth: 0 } });

      // Limits: 2.1 % on average and 3.5 % over all but 5 % of the paper (measured: about 2.02 % and 3.3 %, from 3.6 %
      // and 5.5 % without slits). Auto stops a little over its 3 % target, where more slits stop paying. (The inch
      // version of this pumpkin once measured 1.7 %, but only at exactly those inputs: scaled by 1 ± 1e-9 the cut-out
      // edge comes out differently and it measured 2.02 % too.)
      const withSlits = paperStrain(slit!), without = paperStrain(plain!);
      expect(withSlits.rms).toBeLessThan(0.021);
      expect(withSlits.p95).toBeLessThan(0.035);
      expect(withSlits.rms).toBeLessThan(0.6 * without.rms);
    },
    SLOW,
  );

  it.each(evenSpacingCases.flatMap(([name, input]) => [4, 6, 8].map((count) => [name, count, input] as const)))(
    "with %s, %i slits placed where they help most stretch the paper less than evenly spaced ones did",
    (name, count, input) => {
      const { template } = buildTemplate({ ...input, slits: { count, depth: 2 * IN } });
      const recorded = (even as Record<string, Record<string, number>>)[name][count];

      expect(template!.slits).toHaveLength(count);
      expect(paperStrain(template!).rms).toBeLessThan(recorded);
    },
    SLOW,
  );
});
