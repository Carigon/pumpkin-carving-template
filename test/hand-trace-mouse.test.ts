import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type Gesture, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";

/** A blank-page hand-trace on a 400 × 400 px canvas. */
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

/** A mouse click at screen point `at`. */
function click(editor: HandTrace, at: Point2): void {
  editor.gesture({ type: "tap", at, pointerType: "mouse" });
}

/** A mouse click at page point `p`. */
function clickPage(editor: HandTrace, p: Point2): void {
  click(editor, screenOf(editor, p));
}

/** A drag of `type` (a plain drag, or a pan from Space or the middle button) from screen point `from` to `to`. */
function drag(editor: HandTrace, from: Point2, to: Point2, type: "drag" | "pan" = "drag"): void {
  const g = (phase: "start" | "move" | "end", at: Point2): Gesture => ({ type, phase, from, at, pointerType: "mouse" });
  editor.gesture(g("start", from));
  editor.gesture(g("move", to));
  editor.gesture(g("end", to));
}

/** The mouse hovering at screen point `at`, or gone (null); `pans` while Space is held. */
function hover(editor: HandTrace, at: Point2 | null, pans = false): void {
  editor.gesture({ type: "hover", at, pointerType: "mouse", pans });
}

/** A key pressed while the canvas has focus, with Ctrl (or Cmd) and Shift as given. What the editor said. */
function press(editor: HandTrace, key: string, mods: { ctrl?: boolean; shift?: boolean } = {}): boolean {
  return editor.key({ key, ctrl: mods.ctrl ?? false, shift: mods.shift ?? false });
}

const SQUARE: Point2[] = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.2, y: 0.6 },
];

/** Click each of `points` and then the first again: one closed shape. */
function drawClosed(editor: HandTrace, points: Point2[]): void {
  for (const p of [...points, points[0]]) clickPage(editor, p);
}

/** Every point stored, as plain page coordinates. */
const stored = (editor: HandTrace) => editor.shapes().flatMap((s) => s.points.map(({ x, y }) => ({ x, y })));

/** `actual` is `expected` on screen, to a rounding error. */
function expectNear(actual: Point2, expected: Point2): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

describe("hand-trace editor with a mouse: panning", () => {
  it("a Space-drag or middle-drag pans even from the selected shape, which stays put", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const inside = screenOf(editor, { x: 0.4, y: 0.4 });
    click(editor, inside);
    expect(editor.drawn().pill).toEqual({ kind: "shape" });
    const [before, points] = [editor.drawn().page, stored(editor)];
    drag(editor, inside, { x: inside.x + 30, y: inside.y - 20 }, "pan");
    const page = editor.drawn().page;
    expect(page.x).toBeCloseTo(before.x + 30, 6);
    expect(page.y).toBeCloseTo(before.y - 20, 6);
    expect(stored(editor)).toEqual(points);
    expect(editor.drawn().can.undo).toBe(true);
    editor.undo();
    expect(editor.shapes()[0].closed).toBe(false);
  });

  it("a pan from a point moves the view, not the point", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const [corner, points] = [screenOf(editor, SQUARE[1]), stored(editor)];
    drag(editor, corner, { x: corner.x + 40, y: corner.y }, "pan");
    expect(stored(editor)).toEqual(points);
    expectNear(editor.drawn().points[1].at, { x: corner.x + 40, y: corner.y });
  });

  it("a plain drag on the selected shape moves it, and on empty space pans", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const inside = screenOf(editor, { x: 0.4, y: 0.4 });
    click(editor, inside);
    const page = editor.drawn().page;
    drag(editor, inside, { x: inside.x + page.width * 0.1, y: inside.y });
    expect(stored(editor)[0].x).toBeCloseTo(0.3, 9);
    drag(editor, { x: 380, y: 380 }, { x: 390, y: 380 });
    expect(editor.drawn().page.x).toBeCloseTo(page.x + 10, 6);
  });

  it("a mouse drag of a point moves it with no loupe", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const corner = screenOf(editor, SQUARE[1]);
    const g = (phase: "start" | "move", at: Point2): Gesture => ({
      type: "drag",
      phase,
      from: corner,
      at,
      pointerType: "mouse",
    });
    editor.gesture(g("start", corner));
    editor.gesture(g("move", { x: corner.x + 20, y: corner.y }));
    expect(editor.drawn().loupe).toBeNull();
    expectNear(editor.drawn().points[1].at, { x: corner.x + 20, y: corner.y });
  });
});

describe("hand-trace editor with a mouse: hover", () => {
  /** Where the hover highlights a point or marker. */
  const markAt = (editor: HandTrace): Point2 => {
    const mark = editor.drawn().hover;
    if (mark?.kind !== "point" && mark?.kind !== "marker") throw new Error(`no point hovered: ${JSON.stringify(mark)}`);
    return mark.at;
  };

  it("over empty space with nothing selected, nothing is highlighted and the cursor is a crosshair: a click places", () => {
    const editor = blankPage();
    hover(editor, { x: 100, y: 100 });
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "crosshair", rubberBand: null });
  });

  it("over a point, it highlights the point with a pointer cursor", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const corner = screenOf(editor, SQUARE[2]);
    hover(editor, { x: corner.x + 5, y: corner.y - 5 });
    expect(editor.drawn()).toMatchObject({ hover: { kind: "point" }, cursor: "pointer" });
    expectNear(markAt(editor), corner);
  });

  it("over a shape, it highlights the shape: a pointer cursor to select it, a move cursor once it's selected", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const inside = screenOf(editor, { x: 0.4, y: 0.4 });
    hover(editor, inside);
    const id = editor.shapes()[0].id;
    expect(editor.drawn()).toMatchObject({ hover: { kind: "shape", id }, cursor: "pointer" });
    click(editor, inside);
    expect(editor.drawn()).toMatchObject({ hover: { kind: "shape", id }, cursor: "move" });
  });

  it("over an insert marker of the selected shape, it highlights the marker", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    click(editor, screenOf(editor, { x: 0.4, y: 0.4 }));
    const marker = editor.drawn().markers[0];
    hover(editor, marker);
    expect(editor.drawn()).toMatchObject({ hover: { kind: "marker" }, cursor: "pointer" });
    expectNear(markAt(editor), marker);
  });

  it("over empty space with something selected, nothing is highlighted and the cursor is plain: a click only clears", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    click(editor, screenOf(editor, { x: 0.4, y: 0.4 }));
    hover(editor, screenOf(editor, { x: 0.9, y: 0.9 }));
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "default", rubberBand: null });
  });

  it("while drawing, a rubber band runs from the last point to where a click would place, even over a shape", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, { x: 0.8, y: 0.8 });
    const inside = screenOf(editor, { x: 0.4, y: 0.4 });
    hover(editor, inside);
    const drawn = editor.drawn();
    expect(drawn).toMatchObject({ hover: null, cursor: "crosshair" });
    expectNear(drawn.rubberBand!.from, screenOf(editor, { x: 0.8, y: 0.8 }));
    expectNear(drawn.rubberBand!.to, inside);
  });

  it("the rubber band ends where the point would land: off the page, on its edge", () => {
    const editor = blankPage();
    clickPage(editor, { x: 0.5, y: 0.5 });
    const page = editor.drawn().page;
    hover(editor, { x: page.x - 10, y: page.y + page.height / 2 });
    expectNear(editor.drawn().rubberBand!.to, { x: page.x, y: page.y + page.height / 2 });
  });

  it("while drawing, over the first point of 3 or more, it's highlighted and the band runs to it: a click closes", () => {
    const editor = blankPage();
    for (const p of SQUARE) clickPage(editor, p);
    const first = screenOf(editor, SQUARE[0]);
    hover(editor, { x: first.x + 3, y: first.y });
    expect(editor.drawn()).toMatchObject({ hover: { kind: "point" }, cursor: "pointer" });
    expectNear(markAt(editor), first);
    expectNear(editor.drawn().rubberBand!.to, first);
  });

  it("while drawing, over the last point, it's highlighted with no band: a click ends the shape", () => {
    const editor = blankPage();
    for (const p of SQUARE) clickPage(editor, p);
    hover(editor, screenOf(editor, SQUARE[3]));
    expect(editor.drawn()).toMatchObject({ hover: { kind: "point" }, cursor: "pointer", rubberBand: null });
  });

  it("with Space held, nothing is highlighted, there's no band, and the cursor is an open hand: a press pans", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, { x: 0.8, y: 0.8 });
    hover(editor, screenOf(editor, SQUARE[1]), true);
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "grab", rubberBand: null });
  });

  it("while panning or moving, the cursor is a closed hand and nothing is highlighted", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    hover(editor, { x: 380, y: 380 });
    const pan = (phase: "start" | "end"): Gesture => ({
      type: "pan",
      phase,
      from: { x: 380, y: 380 },
      at: { x: 390, y: 380 },
      pointerType: "mouse",
    });
    editor.gesture(pan("start"));
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "grabbing" });
    editor.gesture(pan("end"));
    const corner = screenOf(editor, SQUARE[1]);
    editor.gesture({ type: "drag", phase: "start", from: corner, at: corner, pointerType: "mouse" });
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "grabbing" });
  });

  it("after a drag ends, it hovers where the drag ended", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const corner = screenOf(editor, SQUARE[1]);
    hover(editor, corner);
    const to = { x: corner.x + 30, y: corner.y };
    drag(editor, corner, to);
    expect(editor.drawn().hover?.kind).toBe("point");
    expectNear(markAt(editor), to);
  });

  it("once the mouse leaves, nothing is highlighted and there's no band", () => {
    const editor = blankPage();
    clickPage(editor, { x: 0.5, y: 0.5 });
    hover(editor, { x: 50, y: 50 });
    hover(editor, null);
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "default", rubberBand: null });
  });

  it("after Done, nothing hovers", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    editor.done();
    hover(editor, screenOf(editor, SQUARE[0]));
    expect(editor.drawn()).toMatchObject({ hover: null, cursor: "default", rubberBand: null });
  });
});

describe("hand-trace editor keys: undo and redo", () => {
  it("Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo", () => {
    const editor = blankPage();
    clickPage(editor, { x: 0.5, y: 0.5 });
    clickPage(editor, { x: 0.6, y: 0.5 });
    expect(press(editor, "z", { ctrl: true })).toBe(true);
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 1, canClose: false });
    expect(press(editor, "z", { ctrl: true })).toBe(true);
    expect(editor.shapes()).toEqual([]);
    expect(press(editor, "Z", { ctrl: true, shift: true })).toBe(true);
    expect(stored(editor)).toHaveLength(1);
    expect(press(editor, "y", { ctrl: true })).toBe(true);
    expect(stored(editor)).toHaveLength(2);
  });

  it("Z or Y without Ctrl does nothing", () => {
    const editor = blankPage();
    clickPage(editor, { x: 0.5, y: 0.5 });
    expect(press(editor, "z")).toBe(false);
    expect(press(editor, "y")).toBe(false);
    expect(stored(editor)).toHaveLength(1);
  });
});

describe("hand-trace editor keys: Enter", () => {
  it("while drawing 3 points or more, closes the shape", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) clickPage(editor, p);
    expect(press(editor, "Enter")).toBe(true);
    expect(editor.shapes()[0].closed).toBe(true);
    expect(editor.design()).not.toBeNull();
  });

  it("while drawing fewer than 3 points, ends the shape open", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 2)) clickPage(editor, p);
    expect(press(editor, "Enter")).toBe(true);
    expect(editor.shapes()[0].closed).toBe(false);
    expect(editor.drawn().pill.kind).toBe("hint");
  });

  it("with an open end selected, carries on drawing from it", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) clickPage(editor, p);
    clickPage(editor, SQUARE[2]);
    clickPage(editor, SQUARE[2]);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: true, smooth: false });
    expect(press(editor, "Enter")).toBe(true);
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
  });

  it("with nothing drawn, or a closed shape's point selected, does nothing", () => {
    const editor = blankPage();
    expect(press(editor, "Enter")).toBe(false);
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    expect(press(editor, "Enter")).toBe(false);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: false, smooth: false });
  });
});

describe("hand-trace editor keys: Escape", () => {
  it("mid-drag, cancels the drag and puts the point back, with no undo step; the rest of the drag does nothing", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    const points = stored(editor);
    const corner = screenOf(editor, SQUARE[1]);
    const g = (phase: "start" | "move" | "end", at: Point2): Gesture => ({
      type: "drag",
      phase,
      from: corner,
      at,
      pointerType: "mouse",
    });
    editor.gesture(g("start", corner));
    editor.gesture(g("move", { x: corner.x + 40, y: corner.y }));
    expect(press(editor, "Escape")).toBe(true);
    expectNear(editor.drawn().points[1].at, corner);
    editor.gesture(g("move", { x: corner.x + 60, y: corner.y }));
    editor.gesture(g("end", { x: corner.x + 60, y: corner.y }));
    expect(stored(editor)).toEqual(points);
    editor.undo();
    expect(editor.shapes()[0].closed).toBe(false);
  });

  it("mid-drag from an insert marker, cancels the insert too", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    click(editor, screenOf(editor, { x: 0.4, y: 0.4 }));
    const marker = editor.drawn().markers[0];
    editor.gesture({ type: "drag", phase: "start", from: marker, at: marker, pointerType: "mouse" });
    editor.gesture({ type: "drag", phase: "move", from: marker, at: { x: marker.x, y: marker.y + 30 }, pointerType: "mouse" });
    press(editor, "Escape");
    expect(editor.drawn().points).toHaveLength(4);
    expect(editor.drawn().pill).toEqual({ kind: "shape" });
  });

  it("mid-pan, puts the view back", () => {
    const editor = blankPage();
    const before = editor.drawn().page;
    const from = { x: 200, y: 200 };
    editor.gesture({ type: "pan", phase: "start", from, at: { x: 250, y: 200 }, pointerType: "mouse" });
    expect(press(editor, "Escape")).toBe(true);
    expect(editor.drawn().page).toEqual(before);
    editor.gesture({ type: "pan", phase: "move", from, at: { x: 280, y: 200 }, pointerType: "mouse" });
    expect(editor.drawn().page).toEqual(before);
  });

  it("while drawing, ends the shape open", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) clickPage(editor, p);
    expect(press(editor, "Escape")).toBe(true);
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(editor.shapes()[0].closed).toBe(false);
  });

  it("with something selected, clears the selection; with nothing, does nothing", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    expect(press(editor, "Escape")).toBe(true);
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(press(editor, "Escape")).toBe(false);
  });
});

describe("hand-trace editor keys: Delete and Backspace", () => {
  it.each(["Delete", "Backspace"])("%s deletes the selected point, as one undo step", (key) => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    expect(press(editor, key)).toBe(true);
    expect(stored(editor)).toHaveLength(3);
    editor.undo();
    expect(stored(editor)).toHaveLength(4);
  });

  it.each(["Delete", "Backspace"])("%s deletes the selected shape", (key) => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    click(editor, screenOf(editor, { x: 0.4, y: 0.4 }));
    expect(press(editor, key)).toBe(true);
    expect(editor.shapes()).toEqual([]);
  });

  it("Backspace while drawing removes the last point placed, as one undo step", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 3)) clickPage(editor, p);
    expect(press(editor, "Backspace")).toBe(true);
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 2, canClose: false });
    expect(stored(editor)[1].x).toBeCloseTo(SQUARE[1].x, 9);
    editor.undo();
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
  });

  it("Backspace on the only point of the shape being drawn removes the shape; drawing has ended", () => {
    const editor = blankPage();
    clickPage(editor, { x: 0.5, y: 0.5 });
    press(editor, "Backspace");
    expect(editor.shapes()).toEqual([]);
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(press(editor, "Backspace")).toBe(false);
  });

  it("Delete while drawing, with nothing selected, does nothing", () => {
    const editor = blankPage();
    for (const p of SQUARE.slice(0, 2)) clickPage(editor, p);
    expect(press(editor, "Delete")).toBe(false);
    expect(stored(editor)).toHaveLength(2);
  });
});

describe("hand-trace editor keys: zoom", () => {
  it("+ (or =) zooms in and − zooms out about the canvas's middle; 0 fits the page again", () => {
    const editor = blankPage();
    const fitted = editor.drawn().page;
    const middle = screenOf(editor, { x: 0.5, y: 0.5 });
    expect(middle).toEqual({ x: 200, y: 200 });
    expect(press(editor, "+")).toBe(true);
    const zoomed = editor.drawn().page;
    expect(zoomed.width).toBeCloseTo(fitted.width * 1.25, 6);
    expectNear(screenOf(editor, { x: 0.5, y: 0.5 }), middle);
    press(editor, "=");
    press(editor, "-");
    expect(editor.drawn().page.width).toBeCloseTo(fitted.width * 1.25, 6);
    drag(editor, { x: 390, y: 390 }, { x: 395, y: 360 });
    expect(press(editor, "0")).toBe(true);
    expect(editor.drawn().page).toEqual(fitted);
  });

  it("the page refits on resize again after 0", () => {
    const editor = blankPage();
    press(editor, "+");
    press(editor, "0");
    editor.resize(800, 400);
    expect(editor.drawn().page.x).toBeGreaterThan(200);
  });

  it("Ctrl with + or − is left to the browser", () => {
    const editor = blankPage();
    expect(press(editor, "+", { ctrl: true })).toBe(false);
    expect(press(editor, "-", { ctrl: true })).toBe(false);
  });
});

describe("hand-trace editor keys: arrow nudges", () => {
  /** The page's size on screen, px. */
  const side = (editor: HandTrace) => editor.drawn().page.width;

  it("nudge the selected point 1 screen px, or 10 with Shift, in the arrow's direction", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    const corner = editor.drawn().points[1].at;
    expect(press(editor, "ArrowRight")).toBe(true);
    expectNear(editor.drawn().points[1].at, { x: corner.x + 1, y: corner.y });
    press(editor, "ArrowUp", { shift: true });
    expectNear(editor.drawn().points[1].at, { x: corner.x + 1, y: corner.y - 10 });
    press(editor, "ArrowLeft");
    press(editor, "ArrowDown");
    expectNear(editor.drawn().points[1].at, { x: corner.x, y: corner.y - 9 });
    expect(stored(editor)[1].y).toBeCloseTo(SQUARE[1].y + 9 / side(editor), 9);
  });

  it("nudge the selected shape as a whole", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    click(editor, screenOf(editor, { x: 0.4, y: 0.4 }));
    const before = editor.drawn().points.map((p) => p.at);
    press(editor, "ArrowDown", { shift: true });
    editor.drawn().points.forEach((p, i) => expectNear(p.at, { x: before[i].x, y: before[i].y + 10 }));
  });

  it("a run of nudges is one undo step, and the selection stays", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    const corner = editor.drawn().points[1].at;
    for (let i = 0; i < 5; i++) press(editor, "ArrowRight");
    editor.undo();
    expectNear(editor.drawn().points[1].at, corner);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: false, smooth: false });
    editor.undo();
    expect(editor.shapes()[0].closed).toBe(false);
  });

  it("anything else between nudges starts a new run", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    const corner = editor.drawn().points[1].at;
    press(editor, "ArrowRight");
    clickPage(editor, SQUARE[1]);
    press(editor, "ArrowRight");
    editor.undo();
    expectNear(editor.drawn().points[1].at, { x: corner.x + 1, y: corner.y });
    editor.undo();
    expectNear(editor.drawn().points[1].at, corner);
  });

  it("each nudge is a finished change: the Design follows it", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    click(editor, screenOf(editor, { x: 0.4, y: 0.4 }));
    const before = editor.design();
    press(editor, "ArrowRight");
    const after = editor.design();
    expect(after).not.toBe(before);
    // Path data keeps a few decimals.
    expect(after!.bbox.minX).toBeCloseTo(before!.bbox.minX + 1 / side(editor), 5);
  });

  it("a point is kept on the page: a nudge against its edge moves nothing and is no undo step", () => {
    const editor = blankPage();
    // Off the page's right edge: placed on it.
    clickPage(editor, { x: 1.01, y: 0.5 });
    clickPage(editor, { x: 0.5, y: 0.5 });
    clickPage(editor, { x: 0.5, y: 0.5 });
    clickPage(editor, { x: 1.01, y: 0.5 });
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: true, smooth: false });
    press(editor, "ArrowRight");
    expect(stored(editor)[0].x).toBe(1);
    editor.undo();
    expect(editor.shapes()).toHaveLength(1);
    expect(stored(editor)).toHaveLength(1);
  });

  it("with nothing selected, arrows do nothing", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    expect(press(editor, "ArrowRight")).toBe(false);
    clickPage(editor, { x: 0.9, y: 0.9 });
    expect(press(editor, "ArrowRight")).toBe(false);
  });
});

describe("hand-trace editor keys: what has no key", () => {
  it("no key clears every shape, and no key moves the selection to another point or shape", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    clickPage(editor, SQUARE[1]);
    for (const key of ["c", "C", "Tab", "n", "]", "PageDown", " "]) {
      expect(press(editor, key)).toBe(false);
      expect(press(editor, key, { shift: true })).toBe(false);
    }
    expect(stored(editor)).toHaveLength(4);
    expect(editor.drawn().points.map((p) => p.selected)).toEqual([false, true, false, false]);
  });

  it("after Done, keys do nothing", () => {
    const editor = blankPage();
    drawClosed(editor, SQUARE);
    editor.done();
    for (const key of ["z", "Enter", "Escape", "Delete", "Backspace", "+", "0", "ArrowRight"]) {
      expect(press(editor, key, { ctrl: key === "z" })).toBe(false);
    }
    expect(editor.shapes()[0].closed).toBe(true);
  });
});
