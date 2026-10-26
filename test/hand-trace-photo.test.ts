import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines } from "./outlines";

/**
 * A cleaned-up photo 4:3 wide, as design space has it (ADR 0003): one unit across, three quarters of one up, y up.
 */
const PHOTO = { width: 1, height: 0.75 };
/** The loader's tolerance on that photo (5e-4 of its long side). */
const TOL = 5e-4;

/** A hand-trace over the 4:3 photo on a 400 × 400 px canvas, its Design by the app's one path-data route. */
function overPhoto(): HandTrace {
  const editor = createHandTrace({ toDesign: designFromPathData, page: PHOTO, photo: true });
  editor.resize(400, 400);
  return editor;
}

/** Where photo point `p` (in design space, y up) is drawn on screen now. */
function screenOf(editor: HandTrace, p: Point2): Point2 {
  const page = editor.drawn().page;
  return { x: page.x + (p.x / PHOTO.width) * page.width, y: page.y + (1 - p.y / PHOTO.height) * page.height };
}

function tap(editor: HandTrace, at: Point2): void {
  editor.gesture({ type: "tap", at, pointerType: "touch" });
}

const stored = (editor: HandTrace) => editor.shapes().flatMap((s) => s.points.map(({ x, y }) => ({ x, y })));

describe("hand-trace editor: over a non-square photo", () => {
  it("draws the photo with its own shape, fitted in the middle of the canvas", () => {
    const { page } = overPhoto().drawn();
    expect(page.width / page.height).toBeCloseTo(4 / 3, 9);
    expect(page.width).toBeGreaterThan(350);
    expect(page.width).toBeLessThanOrEqual(400);
    expect(page.x + page.width / 2).toBeCloseTo(200, 9);
    expect(page.y + page.height / 2).toBeCloseTo(200, 9);
  });

  it("design space is the photo with y up: a tap at its top-right corner is at (1, 0.75)", () => {
    const editor = overPhoto();
    const { page } = editor.drawn();
    tap(editor, { x: page.x + page.width, y: page.y });
    expect(stored(editor)[0].x).toBeCloseTo(1, 9);
    expect(stored(editor)[0].y).toBeCloseTo(0.75, 9);
  });

  it("a tap off the photo places its point clamped to the photo's edge", () => {
    const editor = overPhoto();
    const { page } = editor.drawn();
    tap(editor, { x: page.x + page.width + 30, y: page.y - 30 });
    tap(editor, { x: page.x - 30, y: page.y + page.height / 2 });
    expect(stored(editor)).toEqual([
      { x: 1, y: 0.75 },
      { x: 0, y: expect.closeTo(0.375, 9) as number },
    ]);
  });

  it("a dragged point stays on the photo, not on a square page", () => {
    const editor = overPhoto();
    const corner = { x: 0.5, y: 0.5 };
    tap(editor, screenOf(editor, corner));
    const from = screenOf(editor, corner);
    const to = { x: from.x, y: -500 };
    editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: "mouse" });
    editor.gesture({ type: "drag", phase: "move", from, at: to, pointerType: "mouse" });
    editor.gesture({ type: "drag", phase: "end", from, at: to, pointerType: "mouse" });
    expect(stored(editor)[0].y).toBe(0.75);
  });

  it("a closed shape's Design is in the photo's design units", () => {
    const editor = overPhoto();
    const triangle = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.7 },
    ];
    for (const p of [...triangle, triangle[0]]) tap(editor, screenOf(editor, p));
    expectSameOutlines(editor.design()!.paths, [triangle], TOL);
    expect(editor.page()).toEqual(PHOTO);
  });

  it("shows the photo with no grid and no symmetry axis (Symmetry is off)", () => {
    expect(overPhoto().drawn()).toMatchObject({ grid: false, axis: null });
  });

  it("a blank page, unlike a photo, is gridded and shows the axis", () => {
    const editor = createHandTrace({ toDesign: designFromPathData });
    editor.resize(400, 400);
    const { grid, axis } = editor.drawn();
    expect(grid).toBe(true);
    expect(axis).not.toBeNull();
  });
});
