import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines, outlinesOf } from "./outlines";

/** The loader's tolerance on a blank page (5e-4 of its side). */
const TOL = 5e-4;

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

const SQUARE: Point2[] = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.2, y: 0.6 },
];

/** Tap at screen point `at`. */
function tap(editor: HandTrace, at: Point2): void {
  editor.gesture({ type: "tap", at, pointerType: "touch" });
}

/** Drag from screen point `from` to `to`, as the recognizer reports it. */
function drag(editor: HandTrace, from: Point2, to: Point2): void {
  editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: "touch" });
  editor.gesture({ type: "drag", phase: "move", from, at: to, pointerType: "touch" });
  editor.gesture({ type: "drag", phase: "end", from, at: to, pointerType: "touch" });
}

/** Tap each of `points` and then the first again: one closed shape. */
function drawClosed(editor: HandTrace, points: Point2[]): void {
  for (const p of [...points, points[0]]) tapPage(editor, p);
}

/** A tap on the last point: end the shape being drawn open. */
function endOn(editor: HandTrace, p: Point2): void {
  tapPage(editor, p);
}

/** Every point stored, as plain page coordinates. */
const stored = (editor: HandTrace) => editor.shapes().flatMap((s) => s.points.map(({ x, y }) => ({ x, y })));

describe("hand-trace editor: placing points", () => {
  it("a tap on the first point of a shape with 3+ points closes it and the Design gains it as a carve area", () => {
    const editor = blankPage();
    for (const p of SQUARE) tapPage(editor, p);
    expect(editor.design()).toBeNull();
    tapPage(editor, SQUARE[0]);
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
  });

  it("a closed shape is drawn and filled along its points on screen", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const onScreen = SQUARE.map((p) => screenOf(editor, p));
    const drawn = editor.drawn();
    expectSameOutlines(outlinesOf(drawn.shapes[0].d), [onScreen], 0.01);
    expectSameOutlines(outlinesOf(drawn.fill), [onScreen], 0.01);
  });

  it("a tap on empty space starts a shape: one corner point under the finger, the pill counting it", () => {
    const editor = blankPage();
    tap(editor, { x: 150, y: 120 });
    const drawn = editor.drawn();
    expect(drawn.points).toHaveLength(1);
    expect(drawn.points[0].at.x).toBeCloseTo(150, 6);
    expect(drawn.points[0].at.y).toBeCloseTo(120, 6);
    expect(drawn.points[0].kind).toBe("corner");
    expect(drawn.pill).toEqual({ kind: "drawing", points: 1, canClose: false });
    expect(editor.shapes()).toMatchObject([{ closed: false, mirror: "none", points: [{ kind: "corner" }] }]);
  });

  it("design space is the page with y up: a tap at the page's top-left corner is at (0, 1)", () => {
    const editor = blankPage();
    tapPage(editor, { x: 0, y: 1 });
    expect(stored(editor)[0].x).toBeCloseTo(0, 9);
    expect(stored(editor)[0].y).toBeCloseTo(1, 9);
  });

  it("a tap off the page places its point clamped to the page's edge", () => {
    const editor = blankPage();
    const page = editor.drawn().page;
    tap(editor, { x: page.x - 5, y: page.y + page.height + 5 });
    tap(editor, { x: page.x + page.width / 2, y: page.y - 5 });
    const [corner, top] = stored(editor);
    expect(corner).toEqual({ x: 0, y: 0 });
    expect(top.x).toBeCloseTo(0.5, 9);
    expect(top.y).toBe(1);
  });

  it("each tap on empty space adds a point to the shape being drawn", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
    expect(editor.shapes()).toHaveLength(1);
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
  });

  it("the first point of the shape being drawn shows it can close once there are 3 points", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    tapPage(editor, SQUARE[1]);
    expect(editor.drawn().points.some((p) => p.closable)).toBe(false);
    tapPage(editor, SQUARE[2]);
    expect(editor.drawn().points.map((p) => p.closable)).toEqual([true, false, false]);
  });

  it("a tap on the first point of a 2-point shape doesn't close it", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    tapPage(editor, SQUARE[1]);
    tapPage(editor, SQUARE[0]);
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 2, canClose: false });
    expect(editor.design()).toBeNull();
  });

  it("a tap on the last point ends the shape open: dashed, both ends marked, not carved, with a note", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
    endOn(editor, SQUARE[2]);
    const drawn = editor.drawn();
    expect(drawn.pill.kind).toBe("hint");
    expect(drawn.shapes).toMatchObject([{ closed: false, drawing: false }]);
    expect(drawn.points.map((p) => p.end)).toEqual([true, false, true]);
    expect(drawn.fill).toBe("");
    expect(drawn.note).toBe("1 shape isn't closed and won't be carved");
    expect(editor.design()).toBeNull();
  });

  it("the open-shape note counts every open shape", () => {
    const editor = blankPage();
    tapPage(editor, { x: 0.1, y: 0.1 });
    tapPage(editor, { x: 0.3, y: 0.1 });
    endOn(editor, { x: 0.3, y: 0.1 });
    tapPage(editor, { x: 0.1, y: 0.8 });
    endOn(editor, { x: 0.1, y: 0.8 });
    expect(editor.drawn().note).toBe("2 shapes aren't closed and won't be carved");
    expect(editor.counts()).toEqual({ points: 3, open: 2 });
  });

  it("Close in the pill closes a shape of 3+ points; End ends it open", () => {
    const editor = blankPage();
    for (const p of SQUARE) tapPage(editor, p);
    editor.close();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
    tapPage(editor, { x: 0.8, y: 0.8 });
    tapPage(editor, { x: 0.9, y: 0.8 });
    editor.end();
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(editor.shapes().map((s) => s.closed)).toEqual([true, false]);
  });

  it("Close does nothing to a shape of fewer than 3 points", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    tapPage(editor, SQUARE[1]);
    editor.close();
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 2, canClose: false });
  });

  it("closed shapes are filled together even-odd: a shape drawn inside another stays uncarved", () => {
    const editor = blankPage();
    const inner = SQUARE.map(({ x, y }) => ({ x: 0.3 + (x - 0.2) / 4, y: 0.3 + (y - 0.2) / 4 }));
    // The inner one first: with nothing being drawn, a tap inside a closed shape selects it.
    drawClosed(editor, inner);
    drawClosed(editor, SQUARE);
    expectSameOutlines(editor.design()!.paths, [SQUARE, inner], TOL);
    expect(editor.drawn().shapes).toMatchObject([{ closed: true }, { closed: true }]);
  });

  it("a tap inside a closed shape while drawing still places a point", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.8, y: 0.8 });
    tapPage(editor, { x: 0.4, y: 0.4 });
    expect(editor.drawn().pill).toMatchObject({ kind: "drawing", points: 2 });
  });

  it("a tap on another shape's point while drawing ends the shape being drawn open and selects that point", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.8, y: 0.8 });
    tapPage(editor, { x: 0.9, y: 0.9 });
    tapPage(editor, SQUARE[2]);
    expect(editor.drawn().pill.kind).toBe("point");
    expect(selection(editor)).toEqual({ points: [2], shapes: [0] });
    expect(editor.shapes().map((s) => [s.closed, s.points.length])).toEqual([
      [true, 4],
      [false, 2],
    ]);
  });

  it("a closed shape enclosing no area drops out of the Design quietly", () => {
    const editor = blankPage();
    drawClosed(editor, [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.9, y: 0.1 },
    ]);
    expect(editor.drawn().shapes).toMatchObject([{ closed: true }]);
    expect(editor.design()).toBeNull();
    drawClosed(editor, SQUARE);
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
  });

  it("the Design keeps its object until a finished change, so a pan or zoom never rebuilds it", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const design = editor.design();
    drag(editor, { x: 380, y: 380 }, { x: 300, y: 300 });
    editor.gesture({ type: "wheel", at: { x: 200, y: 200 }, deltaY: -200 });
    expect(editor.design()).toBe(design);
    tapPage(editor, { x: 0.8, y: 0.8 });
    expect(editor.design()).not.toBe(design);
  });
});

/** Which points are selected and which shapes are highlighted, as drawn. */
const selection = (editor: HandTrace) => ({
  points: editor.drawn().points.flatMap((p, i) => (p.selected ? [i] : [])),
  shapes: editor.drawn().shapes.flatMap((s, i) => (s.selected ? [i] : [])),
});

describe("hand-trace editor: selecting", () => {
  it("a tap on a point selects it and highlights its shape; the pill offers Delete point and clearing", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[2]);
    expect(selection(editor)).toEqual({ points: [2], shapes: [0] });
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: false, smooth: false });
  });

  it("a tap on empty space while something is selected only clears the selection", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[2]);
    tapPage(editor, { x: 0.8, y: 0.8 });
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(editor.counts()).toEqual({ points: 4, open: 0 });
    tapPage(editor, { x: 0.8, y: 0.8 });
    expect(editor.counts()).toEqual({ points: 5, open: 1 });
  });

  it("a tap inside a closed shape, or on its outline, selects the shape, and the pill offers Delete shape", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    expect(selection(editor)).toEqual({ points: [], shapes: [0] });
    expect(editor.drawn().pill).toEqual({ kind: "shape" });
    tapPage(editor, { x: 0.9, y: 0.9 });
    const edge = screenOf(editor, { x: 0.3, y: 0.6 });
    tap(editor, { x: edge.x, y: edge.y - 15 });
    expect(selection(editor)).toEqual({ points: [], shapes: [0] });
    expect(editor.counts().points).toBe(4);
  });

  it("an open shape is selected by a tap on its outline; it has no inside", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
    endOn(editor, SQUARE[2]);
    tapPage(editor, { x: 0.6, y: 0.4 });
    expect(selection(editor)).toEqual({ points: [], shapes: [0] });
    tapPage(editor, { x: 0.9, y: 0.9 });
    tapPage(editor, { x: 0.5, y: 0.3 });
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
    expect(editor.counts()).toEqual({ points: 4, open: 2 });
  });

  it("a point is hit within 22 px on screen whatever the zoom, and wins over the outline it sits on", () => {
    for (const deltaY of [0, -1200]) {
      const editor = blankPage();
      drawClosed(editor, SQUARE);
      editor.gesture({ type: "wheel", at: screenOf(editor, SQUARE[0]), deltaY });
      const corner = screenOf(editor, SQUARE[0]);
      tap(editor, { x: corner.x + 20, y: corner.y });
      expect(selection(editor)).toEqual({ points: [0], shapes: [0] });
      tapPage(editor, { x: 0.9, y: 0.9 });
      tap(editor, { x: corner.x - 24, y: corner.y });
      expect(selection(editor)).toEqual({ points: [], shapes: [] });
    }
  });

  it("an outline is hit within 22 px on screen whatever the zoom", () => {
    for (const deltaY of [0, -1200]) {
      const editor = blankPage();
      drawClosed(editor, SQUARE);
      const mid = { x: 0.4, y: 0.2 };
      editor.gesture({ type: "wheel", at: screenOf(editor, mid), deltaY });
      const edge = screenOf(editor, mid);
      tap(editor, { x: edge.x, y: edge.y + 20 });
      expect(selection(editor).shapes).toEqual([0]);
      tapPage(editor, { x: 0.9, y: 0.9 });
      tap(editor, { x: edge.x, y: edge.y + 24 });
      expect(selection(editor).shapes).toEqual([]);
    }
  });

  it("a tap inside a shape drawn inside another selects the inner one", () => {
    const editor = blankPage();
    const inner = SQUARE.map(({ x, y }) => ({ x: 0.3 + (x - 0.2) / 4, y: 0.3 + (y - 0.2) / 4 }));
    drawClosed(editor, inner);
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.35, y: 0.35 });
    expect(selection(editor).shapes).toEqual([0]);
    tapPage(editor, { x: 0.9, y: 0.9 });
    tapPage(editor, { x: 0.5, y: 0.5 });
    expect(selection(editor).shapes).toEqual([1]);
  });
});

/** The page's size on screen, in px per page unit. */
const scaleOf = (editor: HandTrace) => editor.drawn().page.width;

describe("hand-trace editor: dragging", () => {
  it("dragging a point moves it with the finger and selects it, the Design changing once, at the end", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const design = editor.design();
    const from = screenOf(editor, SQUARE[2]);
    const k = scaleOf(editor);
    const grab = { x: from.x + 5, y: from.y + 5 };
    const to = { x: grab.x + 0.1 * k, y: grab.y + 0.2 * k };
    editor.gesture({ type: "drag", phase: "start", from: grab, at: grab, pointerType: "touch" });
    editor.gesture({ type: "drag", phase: "move", from: grab, at: to, pointerType: "touch" });
    expect(editor.drawn().points[2].at.x).toBeCloseTo(from.x + 0.1 * k, 6);
    expect(editor.drawn().points[2].at.y).toBeCloseTo(from.y + 0.2 * k, 6);
    expect(editor.design()).toBe(design);
    editor.gesture({ type: "drag", phase: "end", from: grab, at: to, pointerType: "touch" });
    const moved = [SQUARE[0], SQUARE[1], { x: 0.7, y: 0.4 }, SQUARE[3]];
    expectSameOutlines(editor.design()!.paths, [moved], TOL);
    expect(selection(editor)).toEqual({ points: [2], shapes: [0] });
  });

  it("dragging the selected shape moves it whole", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    const k = scaleOf(editor);
    const from = screenOf(editor, { x: 0.4, y: 0.4 });
    drag(editor, from, { x: from.x + 0.2 * k, y: from.y + 0.1 * k });
    const moved = SQUARE.map(({ x, y }) => ({ x: x + 0.2, y: y - 0.1 }));
    expectSameOutlines(editor.design()!.paths, [moved], TOL);
    expect(selection(editor)).toEqual({ points: [], shapes: [0] });
  });

  it("a drag on an unselected shape pans, as on empty space", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const design = editor.design();
    const before = editor.drawn().points[0].at;
    const from = screenOf(editor, { x: 0.4, y: 0.4 });
    drag(editor, from, { x: from.x + 30, y: from.y });
    expect(editor.drawn().points[0].at.x - before.x).toBeCloseTo(30, 9);
    expect(editor.design()).toBe(design);
    expect(editor.drawn().can.undo).toBe(true);
    editor.undo();
    expect(editor.design()).toBeNull();
  });

  it("with a shape selected, dragging another shape's point moves that point and selects it", () => {
    const editor = blankPage();
    const other = [
      { x: 0.7, y: 0.7 },
      { x: 0.9, y: 0.7 },
      { x: 0.9, y: 0.9 },
    ];
    drawClosed(editor, SQUARE);
    drawClosed(editor, other);
    tapPage(editor, { x: 0.4, y: 0.4 });
    const k = scaleOf(editor);
    const from = screenOf(editor, other[1]);
    drag(editor, from, { x: from.x, y: from.y + 0.1 * k });
    expectSameOutlines(editor.design()!.paths, [SQUARE, [other[0], { x: 0.9, y: 0.6 }, other[2]]], TOL);
    expect(selection(editor)).toEqual({ points: [5], shapes: [1] });
  });

  it("one whole drag is one undo step, and redo puts it back", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const k = scaleOf(editor);
    const from = screenOf(editor, SQUARE[2]);
    for (const step of [10, 20, 0.1 * k]) {
      if (step === 10) editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: "touch" });
      editor.gesture({ type: "drag", phase: "move", from, at: { x: from.x + step, y: from.y }, pointerType: "touch" });
    }
    editor.gesture({ type: "drag", phase: "end", from, at: { x: from.x + 0.1 * k, y: from.y }, pointerType: "touch" });
    const moved = [SQUARE[0], SQUARE[1], { x: 0.7, y: 0.6 }, SQUARE[3]];
    expectSameOutlines(editor.design()!.paths, [moved], TOL);
    editor.undo();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
    editor.redo();
    expectSameOutlines(editor.design()!.paths, [moved], TOL);
  });

  it("a dragged point stops at the page's edge", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const from = screenOf(editor, SQUARE[2]);
    drag(editor, from, { x: from.x + 1000, y: from.y - 1000 });
    expect(stored(editor)[2]).toEqual({ x: 1, y: 1 });
  });

  it("a drag that moves nothing, held against the page's edge, adds no undo step", () => {
    const editor = blankPage();
    tapPage(editor, { x: 1, y: 0.5 });
    endOn(editor, { x: 1, y: 0.5 });
    const from = screenOf(editor, { x: 1, y: 0.5 });
    drag(editor, from, { x: from.x + 50, y: from.y });
    editor.undo();
    expect(editor.shapes()).toEqual([]);
  });

  it("a dragged shape stops whole at the page's edge, keeping its form", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    const from = screenOf(editor, { x: 0.4, y: 0.4 });
    drag(editor, from, { x: from.x - 1000, y: from.y });
    const moved = SQUARE.map(({ x, y }) => ({ x: x - 0.2, y }));
    expectSameOutlines(editor.design()!.paths, [moved], TOL);
  });

  it("a point dragged across its shape's other edge is allowed: the crossing shape stays in the Design", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const k = scaleOf(editor);
    const from = screenOf(editor, SQUARE[2]);
    drag(editor, from, { x: from.x - 0.6 * k, y: from.y });
    const bowTie = [SQUARE[0], SQUARE[1], { x: 0, y: 0.6 }, SQUARE[3]];
    expect(editor.shapes()[0].points).toHaveLength(4);
    const carved = editor.design()!.paths.flat();
    for (const p of bowTie) expect(carved.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < TOL)).toBe(true);
  });

  it("a shape dragged over another is allowed, and their overlap is left uncarved", () => {
    const editor = blankPage();
    const apart = [
      { x: 0.65, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.35 },
      { x: 0.65, y: 0.35 },
    ];
    drawClosed(editor, SQUARE);
    drawClosed(editor, apart);
    tapPage(editor, { x: 0.8, y: 0.2 });
    const k = scaleOf(editor);
    const from = screenOf(editor, { x: 0.8, y: 0.2 });
    drag(editor, from, { x: from.x - 0.2 * k, y: from.y - 0.4 * k });
    const over = apart.map(({ x, y }) => ({ x: x - 0.2, y: y + 0.4 }));
    expectSameOutlines(editor.design()!.paths, [SQUARE, over], TOL);
    expect(editor.drawn().fill).not.toBe("");
  });

  it("a cancelled drag puts the point back and adds no undo step", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const design = editor.design();
    const from = screenOf(editor, SQUARE[2]);
    const to = { x: from.x + 40, y: from.y };
    editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: "touch" });
    editor.gesture({ type: "drag", phase: "move", from, at: to, pointerType: "touch" });
    editor.gesture({ type: "drag", phase: "cancel", from, at: to, pointerType: "touch" });
    expect(editor.drawn().points[2].at).toEqual(from);
    expect(editor.design()).toBe(design);
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
    editor.undo();
    expect(editor.design()).toBeNull();
  });

  it("while drawing, dragging one of its own points moves it and drawing carries on", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
    const k = scaleOf(editor);
    const from = screenOf(editor, SQUARE[1]);
    drag(editor, from, { x: from.x + 0.1 * k, y: from.y });
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
    expect(stored(editor)[1].x).toBeCloseTo(0.7, 9);
    tapPage(editor, SQUARE[3]);
    expect(editor.drawn().pill).toMatchObject({ kind: "drawing", points: 4 });
  });

  it("while drawing, dragging another shape's point ends the shape being drawn open and selects the point", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.8, y: 0.8 });
    const from = screenOf(editor, SQUARE[2]);
    drag(editor, from, { x: from.x + 20, y: from.y });
    expect(editor.drawn().pill.kind).toBe("point");
    expect(editor.counts()).toEqual({ points: 5, open: 1 });
    expect(selection(editor)).toEqual({ points: [2], shapes: [0] });
  });
});

/** The insert markers as page points, rounded so they compare exactly. */
const markersOf = (editor: HandTrace) => {
  const page = editor.drawn().page;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return editor.drawn().markers.map((m) => ({
    x: round((m.x - page.x) / page.width),
    y: round(1 - (m.y - page.y) / page.height),
  }));
};

describe("hand-trace editor: insert markers", () => {
  it("the selected shape shows an insert marker in the middle of each edge", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    expect(editor.drawn().markers).toEqual([]);
    tapPage(editor, { x: 0.4, y: 0.4 });
    expect(markersOf(editor)).toEqual([
      { x: 0.4, y: 0.2 },
      { x: 0.6, y: 0.4 },
      { x: 0.4, y: 0.6 },
      { x: 0.2, y: 0.4 },
    ]);
  });

  it("a selected point's shape shows its insert markers too; an open shape has none on its missing edge", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
    endOn(editor, SQUARE[2]);
    tapPage(editor, SQUARE[0]);
    expect(markersOf(editor)).toEqual([
      { x: 0.4, y: 0.2 },
      { x: 0.6, y: 0.4 },
    ]);
  });

  it("insert markers hide on edges shorter than about 48 px on screen, and show again zoomed in", () => {
    const editor = blankPage();
    const k = scaleOf(editor);
    const short = 40 / k;
    drawClosed(editor, [
      { x: 0.2, y: 0.2 },
      { x: 0.2 + short, y: 0.2 },
      { x: 0.2 + short, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ]);
    tapPage(editor, { x: 0.2 + short, y: 0.4 });
    expect(editor.drawn().markers).toHaveLength(2);
    editor.gesture({ type: "wheel", at: { x: 200, y: 200 }, deltaY: -300 });
    expect(editor.drawn().markers).toHaveLength(4);
  });

  it("insert markers don't show while a shape is being drawn", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[2]);
    tapPage(editor, { x: 0.9, y: 0.9 });
    tapPage(editor, { x: 0.9, y: 0.9 });
    expect(editor.drawn().pill.kind).toBe("drawing");
    expect(editor.drawn().markers).toEqual([]);
  });

  it("a tap on an insert marker adds a corner point there, selected, as one undo step", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    tapPage(editor, { x: 0.6, y: 0.4 });
    expect(editor.shapes()[0].points).toHaveLength(5);
    const added = editor.shapes()[0].points[2];
    expect(added).toEqual({ x: expect.closeTo(0.6, 9) as number, y: expect.closeTo(0.4, 9) as number, kind: "corner" });
    expect(selection(editor)).toEqual({ points: [2], shapes: [0] });
    editor.undo();
    expect(editor.shapes()[0].points).toHaveLength(4);
  });

  it("dragging an insert marker adds a point and moves it, as one undo step", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    const k = scaleOf(editor);
    const from = screenOf(editor, { x: 0.6, y: 0.4 });
    drag(editor, from, { x: from.x + 0.2 * k, y: from.y });
    const moved = [SQUARE[0], SQUARE[1], { x: 0.8, y: 0.4 }, SQUARE[2], SQUARE[3]];
    expectSameOutlines(editor.design()!.paths, [moved], TOL);
    expect(selection(editor)).toEqual({ points: [2], shapes: [0] });
    editor.undo();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
    expect(editor.shapes()[0].points).toHaveLength(4);
  });

  it("a point within reach wins over an insert marker", () => {
    const editor = blankPage();
    const k = scaleOf(editor);
    const near = { x: 0.6 + 15 / k, y: 0.4 };
    tapPage(editor, near);
    endOn(editor, near);
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    tapPage(editor, { x: 0.6 + 10 / k, y: 0.4 });
    expect(selection(editor)).toEqual({ points: [0], shapes: [0] });
    expect(editor.counts().points).toBe(5);
  });
});

const TRIANGLE = SQUARE.slice(0, 3);

describe("hand-trace editor: deleting", () => {
  it("Delete point takes the selected point out of its shape, as one undo step", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[3]);
    editor.delete();
    expectSameOutlines(editor.design()!.paths, [TRIANGLE], TOL);
    expect(editor.shapes()[0].closed).toBe(true);
    expect(editor.drawn().pill.kind).toBe("hint");
    editor.undo();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
  });

  it("Delete shape takes the selected shape away", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    editor.delete();
    expect(editor.shapes()).toEqual([]);
    expect(editor.design()).toBeNull();
    editor.undo();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
  });

  it("deleting a point of a closed 3-point shape deletes the shape", () => {
    const editor = blankPage();
    drawClosed(editor, TRIANGLE);
    tapPage(editor, TRIANGLE[1]);
    editor.delete();
    expect(editor.shapes()).toEqual([]);
  });

  it("deleting an open shape's only point deletes the shape", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    endOn(editor, SQUARE[0]);
    tapPage(editor, SQUARE[0]);
    editor.delete();
    expect(editor.shapes()).toEqual([]);
    expect(editor.drawn().note).toBeNull();
  });

  it("deleting an open shape's end point shortens it", () => {
    const editor = blankPage();
    for (const p of TRIANGLE) tapPage(editor, p);
    endOn(editor, TRIANGLE[2]);
    tapPage(editor, TRIANGLE[2]);
    editor.delete();
    expect(editor.shapes()[0]).toMatchObject({ closed: false, points: [{}, {}] });
    expect(stored(editor).map((p) => p.x)).toEqual([expect.closeTo(0.2, 9), expect.closeTo(0.6, 9)]);
    tapPage(editor, TRIANGLE[0]);
    editor.delete();
    expect(editor.shapes()[0]).toMatchObject({ closed: false, points: [{}] });
    expect(stored(editor)[0].x).toBeCloseTo(TRIANGLE[1].x, 9);
  });

  it("Delete with nothing selected does nothing", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    editor.delete();
    expect(editor.counts().points).toBe(4);
    editor.undo();
    expect(editor.design()).toBeNull();
  });
});

describe("hand-trace editor: carrying on and clearing the selection", () => {
  it("the pill offers Carry on with an open shape's end point selected, and not on its other points", () => {
    const editor = blankPage();
    for (const p of TRIANGLE) tapPage(editor, p);
    endOn(editor, TRIANGLE[2]);
    tapPage(editor, TRIANGLE[0]);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: true, smooth: false });
    tapPage(editor, TRIANGLE[2]);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: true, smooth: false });
    tapPage(editor, TRIANGLE[1]);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: false, smooth: false });
  });

  it("Carry on from the last point continues drawing that shape from there", () => {
    const editor = blankPage();
    for (const p of TRIANGLE) tapPage(editor, p);
    endOn(editor, TRIANGLE[2]);
    tapPage(editor, TRIANGLE[2]);
    editor.carryOn();
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
    tapPage(editor, SQUARE[3]);
    editor.close();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
    expect(editor.shapes()).toHaveLength(1);
  });

  it("Carry on from the first point continues drawing that shape from its first end", () => {
    const editor = blankPage();
    for (const p of TRIANGLE) tapPage(editor, p);
    endOn(editor, TRIANGLE[2]);
    tapPage(editor, TRIANGLE[0]);
    editor.carryOn();
    const added = { x: 0.1, y: 0.5 };
    tapPage(editor, added);
    editor.end();
    const ends = editor.drawn().points.filter((p) => p.end).map((p) => p.at);
    const want = [added, TRIANGLE[2]].map((p) => screenOf(editor, p));
    expect(ends.map(({ x, y }) => [Math.round(x), Math.round(y)]).sort()).toEqual(
      want.map(({ x, y }) => [Math.round(x), Math.round(y)]).sort(),
    );
    expect(editor.counts()).toEqual({ points: 4, open: 1 });
  });

  it("Carry on does nothing unless an open end is selected", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[0]);
    editor.carryOn();
    expect(editor.drawn().pill.kind).toBe("point");
  });

  it("clearing the selection leaves nothing selected and changes no shape", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[1]);
    editor.clearSelection();
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
    expect(editor.drawn().pill.kind).toBe("hint");
    editor.undo();
    expect(editor.design()).toBeNull();
  });

  it("an undo that takes the selected point away clears the selection", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.4, y: 0.4 });
    tapPage(editor, { x: 0.6, y: 0.4 });
    expect(selection(editor).points).toEqual([2]);
    editor.undo();
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
  });
});

describe("hand-trace editor: undo, redo and Clear", () => {
  it("each placed point and each close is one undo step, and redo puts them back", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    editor.undo();
    expect(editor.design()).toBeNull();
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 4, canClose: true });
    editor.undo();
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
    editor.redo();
    editor.redo();
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
    expect(editor.drawn().can).toEqual({ undo: true, redo: false, clear: true });
  });

  it("ending a shape open isn't an undo step", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    tapPage(editor, SQUARE[1]);
    endOn(editor, SQUARE[1]);
    editor.undo();
    expect(editor.counts().points).toBe(1);
  });

  it("Clear removes every shape as one undo step", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, { x: 0.8, y: 0.8 });
    editor.clear();
    expect(editor.shapes()).toEqual([]);
    expect(editor.design()).toBeNull();
    expect(editor.drawn().can.clear).toBe(false);
    editor.undo();
    expect(editor.counts()).toEqual({ points: 5, open: 1 });
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
  });

  it("Clear clears the selection too, so the next tap starts a shape", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    tapPage(editor, SQUARE[1]);
    editor.clear();
    expect(editor.drawn().pill.kind).toBe("hint");
    tapPage(editor, SQUARE[1]);
    expect(editor.counts()).toEqual({ points: 1, open: 1 });
  });

  it("Clear with nothing drawn adds no undo step", () => {
    const editor = blankPage();
    editor.clear();
    expect(editor.drawn().can).toEqual({ undo: false, redo: false, clear: false });
  });

  it("a new change after an undo drops what redo would have put back", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    tapPage(editor, SQUARE[1]);
    editor.undo();
    tapPage(editor, SQUARE[2]);
    expect(editor.drawn().can.redo).toBe(false);
  });

  it("keeps about 200 undo steps, dropping the oldest", () => {
    const editor = blankPage();
    editor.resize(5000, 5000); // room for 250 points well apart
    for (let i = 0; i < 250; i++) tapPage(editor, { x: (i % 50) / 50, y: Math.floor(i / 50) / 5 });
    while (editor.drawn().can.undo) editor.undo();
    expect(editor.counts().points).toBe(50);
  });
});

describe("hand-trace editor: zoom and pan", () => {
  it("fits the square page in the middle of the canvas", () => {
    const editor = createHandTrace({ toDesign: designFromPathData });
    editor.resize(600, 400);
    const { page } = editor.drawn();
    expect(page.width).toBeCloseTo(page.height, 9);
    expect(page.height).toBeLessThanOrEqual(400);
    expect(page.height).toBeGreaterThan(350);
    expect(page.x + page.width / 2).toBeCloseTo(300, 9);
    expect(page.y + page.height / 2).toBeCloseTo(200, 9);
  });

  it("draws the symmetry axis down the page's middle", () => {
    const editor = blankPage();
    const { page, axis } = editor.drawn();
    if (!axis) throw new Error("no axis drawn");
    expect(axis.from.x).toBeCloseTo(page.x + page.width / 2, 9);
    expect(axis.to.x).toBeCloseTo(page.x + page.width / 2, 9);
    expect([axis.from.y, axis.to.y].sort((a, b) => a - b)).toEqual([page.y, page.y + page.height]);
  });

  it("a drag on empty space pans: the page and its points follow the finger", () => {
    const editor = blankPage();
    tapPage(editor, { x: 0.5, y: 0.5 });
    const before = editor.drawn().points[0].at;
    drag(editor, { x: 50, y: 50 }, { x: 80, y: 10 });
    const after = editor.drawn().points[0].at;
    expect(after.x - before.x).toBeCloseTo(30, 9);
    expect(after.y - before.y).toBeCloseTo(-40, 9);
    expect(editor.counts().points).toBe(1);
  });

  it("after a pan, a tap places its point on the page where the finger now is", () => {
    const editor = blankPage();
    tapPage(editor, { x: 0.5, y: 0.5 });
    const at = editor.drawn().points[0].at;
    editor.undo();
    drag(editor, { x: 50, y: 50 }, { x: 80, y: 10 });
    tap(editor, { x: at.x + 30, y: at.y - 40 });
    const placed = stored(editor);
    expect(placed).toHaveLength(1);
    expect(placed[0].x).toBeCloseTo(0.5, 9);
    expect(placed[0].y).toBeCloseTo(0.5, 9);
  });

  it("a wheel turn zooms at the cursor: up zooms in, and the page point under the cursor stays there", () => {
    const editor = blankPage();
    const cursor = { x: 120, y: 260 };
    tap(editor, cursor);
    const under = stored(editor)[0];
    editor.undo();
    const width = editor.drawn().page.width;
    editor.gesture({ type: "wheel", at: cursor, deltaY: -300 });
    expect(editor.drawn().page.width).toBeGreaterThan(width);
    tap(editor, cursor);
    expect(stored(editor)[0].x).toBeCloseTo(under.x, 9);
    expect(stored(editor)[0].y).toBeCloseTo(under.y, 9);
    editor.gesture({ type: "wheel", at: cursor, deltaY: 600 });
    expect(editor.drawn().page.width).toBeLessThan(width);
  });

  it("zoom stops at its limits however far the wheel turns", () => {
    const editor = blankPage();
    const width = editor.drawn().page.width;
    for (let i = 0; i < 50; i++) editor.gesture({ type: "wheel", at: { x: 200, y: 200 }, deltaY: -1000 });
    const most = editor.drawn().page.width;
    expect(most).toBeGreaterThan(width);
    expect(Number.isFinite(most)).toBe(true);
    editor.gesture({ type: "wheel", at: { x: 200, y: 200 }, deltaY: -1000 });
    expect(editor.drawn().page.width).toBe(most);
  });

  it("a resize refits the page until the carver pans or zooms, then keeps their view", () => {
    const editor = blankPage();
    editor.resize(800, 800);
    expect(editor.drawn().page.width).toBeGreaterThan(700);
    drag(editor, { x: 10, y: 10 }, { x: 60, y: 10 });
    const page = editor.drawn().page;
    editor.resize(400, 400);
    expect(editor.drawn().page).toEqual(page);
  });
});

describe("hand-trace editor: Done and Edit", () => {
  it("Done ends the shape being drawn open, hides the tools and stops the canvas taking input", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    tapPage(editor, SQUARE[1]);
    editor.done();
    expect(editor.isDone()).toBe(true);
    expect(editor.drawn()).toMatchObject({ tools: false, pill: { kind: "hint" } });
    const page = editor.drawn().page;
    tapPage(editor, SQUARE[2]);
    drag(editor, { x: 10, y: 10 }, { x: 60, y: 10 });
    editor.gesture({ type: "wheel", at: { x: 200, y: 200 }, deltaY: -300 });
    editor.undo();
    editor.clear();
    expect(editor.counts()).toEqual({ points: 2, open: 1 });
    expect(editor.drawn().page).toEqual(page);
  });

  it("Done clears the selection, and Delete and Carry on do nothing until Edit", () => {
    const editor = blankPage();
    for (const p of TRIANGLE) tapPage(editor, p);
    endOn(editor, TRIANGLE[2]);
    tapPage(editor, TRIANGLE[2]);
    editor.done();
    expect(selection(editor)).toEqual({ points: [], shapes: [] });
    editor.delete();
    editor.carryOn();
    editor.edit();
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(editor.counts()).toEqual({ points: 3, open: 1 });
  });

  it("Edit brings the tools back and taps place points again", () => {
    const editor = blankPage();
    tapPage(editor, SQUARE[0]);
    editor.done();
    editor.edit();
    expect(editor.drawn().tools).toBe(true);
    tapPage(editor, SQUARE[1]);
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 1, canClose: false });
    expect(editor.counts().points).toBe(2);
  });
});

describe("hand-trace editor: the stored record", () => {
  /** The hand-trace reopened from `editor`'s stored record, as after a reload, on the same 400 × 400 px canvas. */
  function reopened(editor: HandTrace): HandTrace {
    const again = createHandTrace({ toDesign: designFromPathData, record: editor.record() });
    again.resize(400, 400);
    return again;
  }

  it("a reopened hand-trace draws the same shapes and points, and carves the same Design", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    for (const p of [{ x: 0.7, y: 0.1 }, { x: 0.9, y: 0.3 }]) tapPage(editor, p);
    endOn(editor, { x: 0.9, y: 0.3 });
    const again = reopened(editor);
    const { shapes, points, fill, note, pill } = editor.drawn();
    expect(again.drawn()).toMatchObject({ shapes, points, fill, note, pill });
    expectSameOutlines(again.design()!.paths, [SQUARE], TOL);
  });

  it("a hand-trace reopened mid-shape carries on drawing that shape", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
    const again = reopened(editor);
    expect(again.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
    tapPage(again, SQUARE[3]);
    tapPage(again, SQUARE[0]);
    expectSameOutlines(again.design()!.paths, [SQUARE], TOL);
  });

  it("a hand-trace reopened after Done is still Done, and Edit carries on", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    editor.done();
    const again = reopened(editor);
    expect(again.isDone()).toBe(true);
    expect(again.drawn().tools).toBe(false);
    again.edit();
    tapPage(again, { x: 0.8, y: 0.8 });
    expect(again.counts()).toEqual({ points: 5, open: 1 });
  });

  it("a reopened hand-trace starts with no undo history, and new shapes don't reuse an id", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const again = reopened(editor);
    expect(again.drawn().can).toEqual({ undo: false, redo: false, clear: true });
    tapPage(again, { x: 0.8, y: 0.8 });
    const ids = again.shapes().map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("the stored record keeps its object until a finished change or Done, so a pan or zoom never rewrites it", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const record = editor.record();
    drag(editor, { x: 380, y: 380 }, { x: 300, y: 300 });
    editor.gesture({ type: "wheel", at: { x: 200, y: 200 }, deltaY: -200 });
    expect(editor.record()).toBe(record);
    editor.done();
    expect(editor.record()).not.toBe(record);
    expect(editor.record().done).toBe(true);
  });
});
