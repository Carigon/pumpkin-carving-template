import { describe, expect, it } from "vitest";
import { buildTemplate, createTemplateBuilder, type BBox, type TemplateInput, type TemplateWarning } from "../src/core";
import { circle, designOf, placed, sphere } from "./slit-cases";

/** The design warnings of a kind, from the full build. */
function warningsOf<K extends TemplateWarning["kind"]>(input: TemplateInput, kind: K) {
  return buildTemplate(input).warnings.filter((w): w is Extract<TemplateWarning, { kind: K }> => w.kind === kind);
}

/** Expect a box to match [minX, minY, maxX, maxY] to within `tolerance` design units. */
function expectBox(box: BBox, [minX, minY, maxX, maxY]: number[], tolerance = 1e-6) {
  for (const [got, want] of [[box.minX, minX], [box.minY, minY], [box.maxX, maxX], [box.maxY, maxY]]) {
    expect(Math.abs(got - want)).toBeLessThan(tolerance);
  }
}

describe("shape warnings", () => {
  it("a pupil inside an eye warns of one floating piece, where the pupil is", () => {
    const eye = designOf(circle(0, 0, 30), circle(10, 5, 8));
    const [warning] = warningsOf({ measurements: sphere, ...placed(eye, 60) }, "floating-piece");

    expect(warning.pieces).toHaveLength(1);
    const [cx, cy, r] = [10, 5, 8];
    // The 24-point circle's corners at 0°, 90°, 180° and 270° touch its box.
    expectBox(warning.pieces[0].bbox, [cx - r, cy - r, cx + r, cy + r]);
  });

  it("a figure-eight warns of one crossing, where its edge crosses itself, and of no floating piece", () => {
    // A bow tie: both loops are carved, held together at the crossing.
    const eight = designOf([[-20, -10], [20, 10], [20, -10], [-20, 10]]);
    const input = { measurements: sphere, ...placed(eight, 60) };
    const [warning] = warningsOf(input, "crossing");

    expect(warning.at).toHaveLength(1);
    expect(warning.at[0].x).toBeCloseTo(0, 9);
    expect(warning.at[0].y).toBeCloseTo(0, 9);
    expect(warningsOf(input, "floating-piece")).toEqual([]);
  });

  it("two partly overlapping shapes warn of their two crossings and of the lens between them as a floating piece", () => {
    const overlap = designOf([[0, 0], [20, 0], [20, 20], [0, 20]], [[10, 10], [30, 10], [30, 30], [10, 30]]);
    const input = { measurements: sphere, ...placed(overlap, 60) };
    const [crossing] = warningsOf(input, "crossing");
    const [floating] = warningsOf(input, "floating-piece");

    const at = crossing.at.map(({ x, y }) => [x, y]).sort((a, b) => a[0] - b[0]);
    expect(at).toEqual([[10, 20], [20, 10]]);
    expect(floating.pieces).toHaveLength(1);
    expectBox(floating.pieces[0].bbox, [10, 10, 20, 20]);
  });

  it("a carved dot inside a pupil inside an eye is the only floating piece: the pupil's ring round the dot", () => {
    const design = designOf(circle(0, 0, 30), circle(0, 0, 15), circle(0, 0, 5));
    const [warning] = warningsOf({ measurements: sphere, ...placed(design, 60) }, "floating-piece");

    expect(warning.pieces).toHaveLength(1);
    expectBox(warning.pieces[0].bbox, [-15, -15, 15, 15]);
    expect(warning.pieces[0].outline).toHaveLength(2);
  });

  it("a carve area 4 mm across on the skin warns, where it is, and stops once the Width takes it past 5 mm", () => {
    // A big carve area and a 4-unit square beside it; at a Width of 100 mm one unit is 1 mm in the front view.
    const design = designOf([[0, 0], [60, 0], [60, 60], [0, 60]], [[96, 28], [100, 28], [100, 32], [96, 32]]);
    const [warning] = warningsOf({ measurements: sphere, ...placed(design, 100) }, "tiny-carve-area");

    expect(warning.minSizeMm).toBe(5);
    expect(warning.areas).toHaveLength(1);
    expectBox(warning.areas[0].bbox, [96, 28, 100, 32]);
    // 5.2 mm in the front view, and more on the skin.
    expect(warningsOf({ measurements: sphere, ...placed(design, 130) }, "tiny-carve-area")).toEqual([]);
  });

  it("measures carve areas on the skin, where it turns away toward the sides, not in the front view", () => {
    // The 4-unit square is 4.5 mm across in the front view, about 220 mm out on a sphere 242 mm in radius, where the
    // skin is turned more than 60° away: it's over twice as wide on the skin.
    const toSide = designOf([[0, 0], [40, 0], [40, 40], [0, 40]], [[396, 18], [400, 18], [400, 22], [396, 22]]);
    expect(warningsOf({ measurements: sphere, ...placed(toSide, 450) }, "tiny-carve-area")).toEqual([]);

    // The same square in the middle of the pumpkin is 4.5 mm across on the skin too.
    const inMiddle = designOf([[0, 0], [40, 0], [40, 40], [0, 40]], [[198, 18], [202, 18], [202, 22], [198, 22]], [[360, 0], [400, 0], [400, 40], [360, 40]]);
    expect(warningsOf({ measurements: sphere, ...placed(inMiddle, 450) }, "tiny-carve-area")).toHaveLength(1);
  });

  it("measures a carve area's box in the design's own axes, so rotating the placement doesn't change the warning", () => {
    // A 4.5 mm square in the middle of the pumpkin: turned 30°, its front-view box is over 6 mm across.
    const design = designOf([[0, 0], [40, 0], [40, 40], [0, 40]], [[198, 18], [202, 18], [202, 22], [198, 22]], [[360, 0], [400, 0], [400, 40], [360, 40]]);
    const turned = (rotation: number) => ({ measurements: sphere, design, placement: { width: 450, verticalOffset: 0, rotation } });

    const [upright] = warningsOf(turned(0), "tiny-carve-area");
    expect(upright.areas).toHaveLength(1);
    expect(warningsOf(turned(30), "tiny-carve-area")).toEqual([upright]);
    expect(warningsOf(turned(-30), "tiny-carve-area")).toEqual([upright]);
  });

  it("the quick preview gives the same shape warnings as the full build", () => {
    const design = designOf(circle(0, 0, 30), circle(10, 5, 8), [[40, -10], [80, 10], [80, -10], [40, 10]], [[90, 0], [92, 0], [92, 2]]);
    const input: TemplateInput = { measurements: sphere, ...placed(design, 150), slits: { count: 0, depth: 0 } };
    const shape = (warnings: TemplateWarning[]) => warnings.filter((w) => ["crossing", "floating-piece", "tiny-carve-area"].includes(w.kind));

    const quick = shape(createTemplateBuilder().preview(input).warnings);
    expect(quick.map((w) => w.kind)).toEqual(["crossing", "floating-piece", "tiny-carve-area"]);
    expect(quick).toEqual(shape(buildTemplate(input).warnings));
  });

  it("shapes side by side warn of no crossing and no floating piece", () => {
    const design = designOf(circle(-20, 0, 8), circle(20, 0, 8), [[-25, -30], [25, -30], [0, -20]]);
    const kinds = buildTemplate({ measurements: sphere, ...placed(design, 60) }).warnings.map((w) => w.kind);
    expect(kinds).not.toContain("crossing");
    expect(kinds).not.toContain("floating-piece");
  });
});
