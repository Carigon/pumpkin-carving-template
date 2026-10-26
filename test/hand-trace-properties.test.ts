import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines } from "./outlines";

/** The canvas the sequences run on, in px. */
const SIZE = 400;
/** Outlines smaller than this (in page area) are left out of the comparison: a sliver may or may not enclose area. */
const TINY_AREA = 1e-4;

/** One random step: a gesture somewhere on (or just off) the canvas, a tap on an existing point, or a command. */
type Step =
  | { kind: "tap"; at: Point2 }
  | { kind: "tapPoint"; index: number }
  | { kind: "pan"; from: Point2; to: Point2 }
  | { kind: "wheel"; at: Point2; deltaY: number }
  | { kind: "close" | "end" | "undo" | "redo" | "clear" };

/**
 * A screen pixel anywhere on the canvas or just off it, spread evenly: fast-check's doubles cluster near zero, and
 * its usual bias to the extremes would put most taps on the page's edges.
 */
const coordinate = fc.noBias(fc.integer({ min: -20, max: SIZE + 20 }));
const screen = fc.record({ x: coordinate, y: coordinate });
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("tap" as const), at: screen }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("tapPoint" as const), index: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("pan" as const), from: screen, to: screen }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("wheel" as const), at: screen, deltaY: fc.integer({ min: -400, max: 400 }) }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constantFrom("close", "end", "undo", "redo", "clear" as const) }) },
);

function run(editor: HandTrace, s: Step): void {
  const touch = "touch" as const;
  switch (s.kind) {
    case "tap":
      return editor.gesture({ type: "tap", at: s.at, pointerType: touch });
    case "tapPoint": {
      const points = editor.drawn().points;
      if (points.length > 0) editor.gesture({ type: "tap", at: points[s.index % points.length].at, pointerType: touch });
      return;
    }
    case "pan":
      for (const phase of ["start", "move", "end"] as const)
        editor.gesture({ type: "drag", phase, from: s.from, at: phase === "start" ? s.from : s.to, pointerType: touch });
      return;
    case "wheel":
      return editor.gesture({ type: "wheel", at: s.at, deltaY: s.deltaY });
    default:
      return editor[s.kind]();
  }
}

function area(path: readonly Point2[]): number {
  return Math.abs(path.reduce((sum, p, i) => sum + p.x * path[(i + 1) % path.length].y - path[(i + 1) % path.length].x * p.y, 0)) / 2;
}

/** The invariants after every step. */
function check(editor: HandTrace): void {
  const shapes = editor.shapes();
  for (const p of shapes.flatMap((s) => s.points)) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(1);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(1);
  }
  const closed = shapes.filter((s) => s.closed).map((s) => s.points.map(({ x, y }) => ({ x, y })));
  const carved = editor.design()?.paths ?? [];
  expect(carved.length).toBeLessThanOrEqual(closed.length);
  const big = (paths: readonly Point2[][]) => paths.filter((p) => area(p) > TINY_AREA);
  expectSameOutlines(big(carved), big(closed), 1e-3);
}

describe("hand-trace editor: random sequences", () => {
  it("keeps points on the page, carves exactly the closed shapes, and undoes back to the start", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 5, maxLength: 40, size: "max" }), (steps) => {
        const editor = createHandTrace({ toDesign: designFromPathData });
        editor.resize(SIZE, SIZE);
        for (const s of steps) {
          run(editor, s);
          check(editor);
        }
        while (editor.drawn().can.undo) editor.undo();
        expect(editor.shapes()).toEqual([]);
        expect(editor.design()).toBeNull();
      }),
      { seed: 27, numRuns: 200 },
    );
  });
});
