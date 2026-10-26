import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { readRecord, writeRecord } from "../src/designRecord";
import { createHandTrace, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines } from "./outlines";

/** The canvas the sequences run on, in px. */
const SIZE = 400;
/** Outlines smaller than this (in page area) are left out of the comparison: a sliver may or may not enclose area. */
const TINY_AREA = 1e-4;

/** The commands a step can press. */
const COMMANDS = ["close", "end", "undo", "redo", "clear", "delete", "carryOn", "clearSelection"] as const;

/**
 * One random step: a gesture somewhere on (or just off) the canvas; a tap on, or drag from, an existing point, insert
 * marker or shape's edge; or a command.
 */
type Step =
  | { kind: "tap"; at: Point2 }
  | { kind: "tapOn"; target: Target; index: number }
  | { kind: "drag"; from: Point2; to: Point2; cancel: boolean }
  | { kind: "dragFrom"; target: Target; index: number; to: Point2; cancel: boolean }
  | { kind: "wheel"; at: Point2; deltaY: number }
  | { kind: "hold"; from: Point2; to: Point2; cancel: boolean }
  | { kind: "holdOn"; target: Target; index: number; to: Point2; cancel: boolean }
  | { kind: "pinch"; from: Point2; at: Point2; scale: number }
  | { kind: "multiTap"; fingers: 2 | 3 }
  | { kind: (typeof COMMANDS)[number] | "done" | "edit" };

/** What a step aims at: a point, an insert marker, or a spot on a shape's outline (a quarter along its first edge). */
type Target = "point" | "marker" | "outline";

/**
 * A screen pixel anywhere on the canvas or just off it, spread evenly: fast-check's doubles cluster near zero, and
 * its usual bias to the extremes would put most taps on the page's edges.
 */
const coordinate = fc.noBias(fc.integer({ min: -20, max: SIZE + 20 }));
const screen = fc.record({ x: coordinate, y: coordinate });
const target = fc.constantFrom<Target>("point", "marker", "outline");
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("tap" as const), at: screen }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("tapOn" as const), target, index: fc.nat() }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("drag" as const), from: screen, to: screen, cancel: fc.boolean() }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("dragFrom" as const),
      target,
      index: fc.nat(),
      to: screen,
      cancel: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("wheel" as const), at: screen, deltaY: fc.integer({ min: -400, max: 400 }) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant("hold" as const), from: screen, to: screen, cancel: fc.boolean() }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("holdOn" as const),
      target,
      index: fc.nat(),
      to: screen,
      cancel: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("pinch" as const),
      from: screen,
      at: screen,
      scale: fc.constantFrom(0.5, 0.8, 1.25, 2),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("multiTap" as const), fingers: fc.constantFrom(2 as const, 3 as const) }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constantFrom(...COMMANDS) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom("done", "edit" as const) }) },
);

/** Where `target` number `index` (wrapping round) is on screen now, if there's any. */
function spot(editor: HandTrace, target: Target, index: number): Point2 | null {
  const drawn = editor.drawn();
  if (target === "point" || target === "marker") {
    const all = target === "point" ? drawn.points.map((p) => p.at) : drawn.markers;
    return all.length > 0 ? all[index % all.length] : null;
  }
  const shapes = editor.shapes().filter((s) => s.points.length >= 2);
  if (shapes.length === 0) return null;
  const [a, b] = shapes[index % shapes.length].points;
  const { page } = drawn;
  const p = { x: (3 * a.x + b.x) / 4, y: (3 * a.y + b.y) / 4 };
  return { x: page.x + p.x * page.width, y: page.y + (1 - p.y) * page.height };
}

function dragOf(editor: HandTrace, from: Point2, to: Point2, cancel: boolean): void {
  const touch = "touch" as const;
  editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: touch });
  editor.gesture({ type: "drag", phase: "move", from, at: to, pointerType: touch });
  editor.gesture({ type: "drag", phase: cancel ? "cancel" : "end", from, at: to, pointerType: touch });
}

/** A touch hold at `from`, aimed to `to`, then lifted or cancelled (as a second finger landing does). */
function holdOf(editor: HandTrace, from: Point2, to: Point2, cancel: boolean): void {
  const touch = "touch" as const;
  editor.gesture({ type: "hold", phase: "start", from, at: from, pointerType: touch });
  editor.gesture({ type: "hold", phase: "move", from, at: to, pointerType: touch });
  editor.gesture({ type: "hold", phase: cancel ? "cancel" : "end", from, at: to, pointerType: touch });
}

function run(editor: HandTrace, s: Step): void {
  const touch = "touch" as const;
  switch (s.kind) {
    case "tap":
      return editor.gesture({ type: "tap", at: s.at, pointerType: touch });
    case "tapOn": {
      const at = spot(editor, s.target, s.index);
      if (at) editor.gesture({ type: "tap", at, pointerType: touch });
      return;
    }
    case "drag":
      return dragOf(editor, s.from, s.to, s.cancel);
    case "dragFrom": {
      const from = spot(editor, s.target, s.index);
      if (from) dragOf(editor, from, s.to, s.cancel);
      return;
    }
    case "wheel":
      return editor.gesture({ type: "wheel", at: s.at, deltaY: s.deltaY });
    case "hold":
      return holdOf(editor, s.from, s.to, s.cancel);
    case "holdOn": {
      const from = spot(editor, s.target, s.index);
      if (from) holdOf(editor, from, s.to, s.cancel);
      return;
    }
    case "pinch":
      return editor.gesture({ type: "pinch", from: s.from, at: s.at, scale: s.scale, pointerType: touch });
    case "multiTap":
      return editor.gesture({ type: "multiTap", fingers: s.fingers, pointerType: touch });
    default:
      return editor[s.kind]();
  }
}

function area(path: readonly Point2[]): number {
  return Math.abs(path.reduce((sum, p, i) => sum + p.x * path[(i + 1) % path.length].y - path[(i + 1) % path.length].x * p.y, 0)) / 2;
}

/** The invariants after every step. */
function check(editor: HandTrace): void {
  const drawn = editor.drawn();
  const selected = drawn.points.filter((p) => p.selected).length;
  expect(selected).toBeLessThanOrEqual(1);
  expect(drawn.shapes.filter((s) => s.selected).length).toBeLessThanOrEqual(1);
  expect(drawn.pill.kind === "point").toBe(selected === 1);
  // Every step's gesture has lifted: nothing is aiming.
  expect(drawn.loupe).toBeNull();
  if (drawn.pill.kind === "drawing") expect(drawn.markers).toEqual([]);
  const shapes = editor.shapes();
  expect(shapes.every((s) => s.points.length > 0 && (!s.closed || s.points.length >= 3))).toBe(true);
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
  const again = reloaded(editor);
  expect(again.shapes()).toEqual(editor.shapes());
  expect(again.design()).toEqual(editor.design());
  // The selection isn't kept, like the view: what's drawn matches whenever nothing is selected.
  if (drawn.pill.kind !== "point" && drawn.pill.kind !== "shape") expect(drawnState(again)).toEqual(drawnState(editor));
}

/**
 * The hand-trace after its record is saved and loaded back: written, through JSON as the hand-trace file carries
 * it, and read by the record module's validator.
 */
function reloaded(editor: HandTrace): HandTrace {
  const saved = writeRecord({ source: "page", page: editor.page(), handTrace: editor.record() });
  const loaded = readRecord(JSON.parse(JSON.stringify(saved)));
  if (loaded?.source !== "page") throw new Error("the record didn't load as a blank page");
  const again = createHandTrace({ toDesign: designFromPathData, page: loaded.page, record: loaded.handTrace });
  again.resize(SIZE, SIZE);
  return again;
}

/**
 * What's drawn, as a fraction of the drawn page so the view (zoom and pan, not kept) drops out. Undo and redo are
 * left out too: history isn't kept either (nor the selection, so callers compare this only with nothing selected).
 */
function drawnState(editor: HandTrace) {
  const { page, points, shapes, pill, note, can, tools } = editor.drawn();
  // Rounded: the same page point lands a rounding error apart under two views.
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const onPage = (p: Point2) => ({ x: round((p.x - page.x) / page.width), y: round((p.y - page.y) / page.height) });
  return {
    points: points.map((p) => ({ ...p, at: onPage(p.at) })),
    shapes: shapes.map(({ id, closed, drawing }) => ({ id, closed, drawing })),
    pill,
    note,
    clear: can.clear,
    tools,
  };
}

describe("hand-trace editor: random sequences", () => {
  it("keeps one thing selected and points on the page, carves the closed shapes, reloads as drawn, undoes to start", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 5, maxLength: 40, size: "max" }), (steps) => {
        const editor = createHandTrace({ toDesign: designFromPathData });
        editor.resize(SIZE, SIZE);
        for (const s of steps) {
          run(editor, s);
          check(editor);
        }
        editor.edit(); // Done stops undo too.
        while (editor.drawn().can.undo) editor.undo();
        expect(editor.shapes()).toEqual([]);
        expect(editor.design()).toBeNull();
      }),
      { seed: 27, numRuns: 200 },
    );
  });
});
