import { describe, expect, it } from "vitest";
import { createTemplateBuilder, type Point2 } from "../src/core";
import { createHandTrace, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines, outlinesOf } from "./outlines";
import { sphere } from "./slit-cases";

/** A blank-page hand-trace on a 400 × 400 px canvas, its Design by the app's one path-data route. */
function blankPage(): HandTrace {
  const editor = createHandTrace({ toDesign: designFromPathData });
  editor.resize(400, 400);
  return editor;
}

/** Where page point `p` (relative to the page, y up) is drawn on screen now. */
function screenOf(editor: HandTrace, p: Point2): Point2 {
  const page = editor.drawn().page;
  return { x: page.x + p.x * page.width, y: page.y + (1 - p.y) * page.height };
}

/** Tap at page point `p` (relative to the page, y up). */
function tapPage(editor: HandTrace, p: Point2): void {
  editor.gesture({ type: "tap", at: screenOf(editor, p), pointerType: "touch" });
}

/** Tap each of `points` and then the first again: one closed shape. */
function drawClosed(editor: HandTrace, points: Point2[]): void {
  for (const p of [...points, points[0]]) tapPage(editor, p);
}

/** Show the editor the warnings the core's quick preview gives for its Design, `width` mm wide on a round pumpkin. */
function showCoreWarnings(editor: HandTrace, width = 150): void {
  const design = editor.design() ?? undefined;
  const placement = { width, verticalOffset: 0, rotation: 0 };
  editor.showWarnings(createTemplateBuilder().preview({ measurements: sphere, design, placement }).warnings);
}

/** Expect screen point `got` within `tolerance` px of `want`. */
function expectNear(got: Point2, want: Point2, tolerance = 0.5) {
  expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(tolerance);
}

/** A square's corners, from page point (x0, y0) to (x1, y1). */
const square = (x0: number, y0: number, x1: number, y1: number): Point2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * A figure-eight whose edges cross at page point (0.3, 0.3), its loops unequal (equal loops have no area in all,
 * so they'd leave no Design).
 */
const FIGURE_EIGHT: Point2[] = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.6, y: 0.3 },
  { x: 0.2, y: 0.3 },
];

describe("hand-trace editor: warning marks", () => {
  it("a figure-eight is marked with a ring where its edges cross", () => {
    const editor = blankPage();
    drawClosed(editor, FIGURE_EIGHT);
    showCoreWarnings(editor);

    const { crossings } = editor.drawn().warnings;
    expect(crossings).toHaveLength(1);
    expectNear(crossings[0], screenOf(editor, { x: 0.3, y: 0.3 }));
  });

  it("marks stay put mid-drag, go once the drag ends, and come back where the new Design's warnings say", () => {
    const editor = blankPage();
    drawClosed(editor, FIGURE_EIGHT);
    showCoreWarnings(editor);
    const [from, to] = [screenOf(editor, { x: 0.2, y: 0.3 }), screenOf(editor, { x: 0.2, y: 0.4 })];

    editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: "touch" });
    editor.gesture({ type: "drag", phase: "move", from, at: to, pointerType: "touch" });
    expectNear(editor.drawn().warnings.crossings[0], screenOf(editor, { x: 0.3, y: 0.3 }));

    editor.gesture({ type: "drag", phase: "end", from, at: to, pointerType: "touch" });
    // The edge from (0.6, 0.3) now runs up to (0.2, 0.4), crossing y = x at 0.36.
    expect(editor.drawn().warnings.crossings).toEqual([]);
    showCoreWarnings(editor);
    expectNear(editor.drawn().warnings.crossings[0], screenOf(editor, { x: 0.36, y: 0.36 }));
  });

  it("a pupil inside an eye is tinted as a floating piece, over the pupil", () => {
    const editor = blankPage();
    // The pupil first: with nothing being drawn, a tap inside the eye would select it.
    drawClosed(editor, square(0.4, 0.4, 0.5, 0.5));
    drawClosed(editor, square(0.2, 0.2, 0.7, 0.7));
    showCoreWarnings(editor);

    const { floating } = editor.drawn().warnings;
    expect(floating).toHaveLength(1);
    expectSameOutlines(outlinesOf(floating[0]), [square(0.4, 0.4, 0.5, 0.5).map((p) => screenOf(editor, p))], 0.5);
  });

  it("a tiny carve area is ringed: a ring round its middle that reaches its box's corners", () => {
    const editor = blankPage();
    drawClosed(editor, square(0.1, 0.1, 0.6, 0.6));
    drawClosed(editor, square(0.7, 0.5, 0.8, 0.6));
    // 30 mm across the 0.7-wide Design: the small square is about 4.3 mm across, under 5 mm.
    showCoreWarnings(editor, 30);

    const { tiny } = editor.drawn().warnings;
    expect(tiny).toHaveLength(1);
    const [corner, middle] = [screenOf(editor, { x: 0.7, y: 0.5 }), screenOf(editor, { x: 0.75, y: 0.55 })];
    expectNear(tiny[0].at, middle);
    expect(tiny[0].r).toBeCloseTo(Math.hypot(corner.x - middle.x, corner.y - middle.y), 1);
  });
});
