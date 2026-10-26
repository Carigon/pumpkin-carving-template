import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import {
  createGestureRecognizer,
  createHandTrace,
  type Gesture,
  type HandTrace,
  type PointerInput,
} from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";

/** A blank-page hand-trace on a 400 × 400 px canvas. */
function blankPage(): HandTrace {
  const editor = createHandTrace({ toDesign: designFromPathData });
  editor.resize(400, 400);
  return editor;
}

/** A hold by touch: pressed at `from`, aimed through `path`, then lifted (or cancelled) where the path ends. */
function hold(editor: HandTrace, from: Point2, path: Point2[] = [], end: "end" | "cancel" = "end"): void {
  const g = (phase: "start" | "move" | "end" | "cancel", at: Point2): Gesture => ({
    type: "hold",
    phase,
    from,
    at,
    pointerType: "touch",
  });
  editor.gesture(g("start", from));
  for (const at of path) editor.gesture(g("move", at));
  editor.gesture(g(end, path.at(-1) ?? from));
}

/**
 * Fingers on the canvas, through the gesture recognizer as the canvas forwards them: `down`, `move` and `up` for
 * finger `id` at screen point (x, y) at `t` ms.
 */
function touchscreen(editor: HandTrace) {
  const recognizer = createGestureRecognizer();
  const send = (gestures: Gesture[]) => gestures.forEach((g) => editor.gesture(g));
  const input = (id: number, x: number, y: number, t: number): PointerInput => ({
    id,
    x,
    y,
    t,
    pointerType: "touch",
    button: 0,
  });
  return {
    down: (id: number, x: number, y: number, t: number) => send(recognizer.down(input(id, x, y, t))),
    move: (id: number, x: number, y: number, t: number) => send(recognizer.move(input(id, x, y, t))),
    up: (id: number, x: number, y: number, t: number) => send(recognizer.up(input(id, x, y, t))),
    tick: (t: number) => send(recognizer.tick(t)),
  };
}

/** `actual` is `expected` on screen, to a rounding error. */
function expectNear(actual: Point2, expected: Point2): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

describe("hand-trace editor by touch: the loupe", () => {
  it("a hold on empty space shows the loupe aimed under the finger, and lifting places the point there", () => {
    const editor = blankPage();
    const from = { x: 150, y: 250 };
    editor.gesture({ type: "hold", phase: "start", from, at: from, pointerType: "touch" });
    expect(editor.drawn().points).toEqual([]);
    expect(editor.drawn().loupe).toMatchObject({ focus: from, magnification: 3 });
    const aim = { x: 156, y: 247 };
    editor.gesture({ type: "hold", phase: "move", from, at: aim, pointerType: "touch" });
    expect(editor.drawn().loupe?.focus).toEqual(aim);
    editor.gesture({ type: "hold", phase: "end", from, at: aim, pointerType: "touch" });
    const drawn = editor.drawn();
    expect(drawn.loupe).toBeNull();
    expect(drawn.points).toHaveLength(1);
    expect(drawn.points[0].at.x).toBeCloseTo(aim.x, 6);
    expect(drawn.points[0].at.y).toBeCloseTo(aim.y, 6);
    expect(drawn.pill).toEqual({ kind: "drawing", points: 1, canClose: false });
  });

  it("the loupe is 130 px across and sits above the finger, clear of it", () => {
    const editor = blankPage();
    const finger = { x: 200, y: 300 };
    editor.gesture({ type: "hold", phase: "start", from: finger, at: finger, pointerType: "touch" });
    const { box } = editor.drawn().loupe!;
    expect(box).toMatchObject({ width: 130, height: 130 });
    expect(box.x + box.width / 2).toBeCloseTo(200, 6);
    expect(box.y + box.height).toBeLessThan(300 - 22);
  });

  it("near the top edge the loupe sits beside the finger instead, on the side with room, inside the canvas", () => {
    for (const x of [100, 350]) {
      const editor = blankPage();
      editor.gesture({ type: "hold", phase: "start", from: { x, y: 40 }, at: { x, y: 40 }, pointerType: "touch" });
      const { box } = editor.drawn().loupe!;
      expect(box.x > x + 22 || box.x + box.width < x - 22).toBe(true);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(400);
    }
  });

  it("the loupe shows on a touch drag of a point, aimed at the point as it moves", () => {
    const editor = blankPage();
    hold(editor, { x: 100, y: 100 });
    const from = { x: 100, y: 100 };
    editor.gesture({ type: "drag", phase: "start", from, at: { x: 115, y: 100 }, pointerType: "touch" });
    editor.gesture({ type: "drag", phase: "move", from, at: { x: 130, y: 120 }, pointerType: "touch" });
    const loupe = editor.drawn().loupe!;
    expect(loupe.focus.x).toBeCloseTo(130, 6);
    expect(loupe.focus.y).toBeCloseTo(120, 6);
    editor.gesture({ type: "drag", phase: "end", from, at: { x: 130, y: 120 }, pointerType: "touch" });
    expect(editor.drawn().loupe).toBeNull();
  });

  it("no loupe for a mouse or pen, on a drag of a point or anywhere else", () => {
    for (const pointerType of ["mouse", "pen"] as const) {
      const editor = blankPage();
      editor.gesture({ type: "tap", at: { x: 100, y: 100 }, pointerType });
      const from = { x: 100, y: 100 };
      editor.gesture({ type: "drag", phase: "start", from, at: { x: 130, y: 120 }, pointerType });
      expect(editor.drawn().loupe).toBeNull();
      expect(editor.drawn().points[0].at.x).toBeCloseTo(130, 6);
    }
  });

  it("a hold on a point moves it with the loupe, as one undo step", () => {
    const editor = blankPage();
    hold(editor, { x: 100, y: 100 });
    hold(editor, { x: 200, y: 100 });
    const from = { x: 200, y: 100 };
    editor.gesture({ type: "hold", phase: "start", from, at: from, pointerType: "touch" });
    editor.gesture({ type: "hold", phase: "move", from, at: { x: 204, y: 130 }, pointerType: "touch" });
    expectNear(editor.drawn().loupe!.focus, { x: 204, y: 130 });
    editor.gesture({ type: "hold", phase: "end", from, at: { x: 204, y: 130 }, pointerType: "touch" });
    expectNear(editor.drawn().points[1].at, { x: 204, y: 130 });
    editor.undo();
    expectNear(editor.drawn().points[1].at, { x: 200, y: 100 });
  });

  it("a hold inside a closed shape, with nothing being drawn, places nothing: lifted it selects the shape", () => {
    const editor = blankPage();
    for (const at of [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 100 },
    ])
      editor.gesture({ type: "tap", at, pointerType: "touch" });
    const from = { x: 250, y: 150 };
    editor.gesture({ type: "hold", phase: "start", from, at: from, pointerType: "touch" });
    expect(editor.drawn().loupe).toBeNull();
    editor.gesture({ type: "hold", phase: "end", from, at: from, pointerType: "touch" });
    expect(editor.shapes()).toHaveLength(1);
    expect(editor.drawn().pill).toEqual({ kind: "shape" });
  });

  it("a hold inside a closed shape while drawing another aims the loupe and places a point there", () => {
    const editor = blankPage();
    for (const at of [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 100 },
    ])
      editor.gesture({ type: "tap", at, pointerType: "touch" });
    editor.gesture({ type: "tap", at: { x: 350, y: 350 }, pointerType: "touch" });
    hold(editor, { x: 250, y: 150 });
    expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 2, canClose: false });
  });

  it("a hold with something selected places nothing: lifted it's a tap, moved it's a drag", () => {
    const editor = blankPage();
    hold(editor, { x: 100, y: 100 });
    editor.end();
    editor.gesture({ type: "tap", at: { x: 100, y: 100 }, pointerType: "touch" });
    expect(editor.drawn().pill.kind).toBe("point");
    hold(editor, { x: 300, y: 300 });
    expect(editor.drawn().pill.kind).toBe("hint");
    expect(editor.shapes()).toHaveLength(1);
    editor.gesture({ type: "tap", at: { x: 100, y: 100 }, pointerType: "touch" });
    const page = editor.drawn().page;
    hold(editor, { x: 300, y: 300 }, [{ x: 320, y: 290 }]);
    expect(editor.drawn().page).toMatchObject({ x: page.x + 20, y: page.y - 10 });
    expect(editor.drawn().loupe).toBeNull();
    expect(editor.shapes()).toHaveLength(1);
  });

  it("a cancelled hold places nothing and leaves no loupe or undo step", () => {
    const editor = blankPage();
    hold(editor, { x: 100, y: 100 }, [{ x: 120, y: 110 }], "cancel");
    expect(editor.drawn()).toMatchObject({ points: [], loupe: null, can: { undo: false } });
  });

  it("no loupe while panning or moving a whole shape", () => {
    const editor = blankPage();
    const from = { x: 300, y: 300 };
    editor.gesture({ type: "drag", phase: "start", from, at: { x: 330, y: 300 }, pointerType: "touch" });
    expect(editor.drawn().loupe).toBeNull();
  });
});

describe("hand-trace editor by touch: more than one finger", () => {
  /** Two points placed by tapping, at (100, 100) and (200, 100). */
  function twoPoints(fingers: ReturnType<typeof touchscreen>): void {
    fingers.down(1, 100, 100, 0);
    fingers.up(1, 100, 100, 50);
    fingers.down(1, 200, 100, 1000);
    fingers.up(1, 200, 100, 1050);
  }

  it("a second finger landing mid-drag puts the point back where it was, with no undo step", () => {
    const editor = blankPage();
    const fingers = touchscreen(editor);
    twoPoints(fingers);
    const [undoable, shapes] = [editor.drawn().can, editor.shapes()];
    fingers.down(1, 200, 100, 2000);
    fingers.move(1, 240, 150, 2050);
    expectNear(editor.drawn().points[1].at, { x: 240, y: 150 });
    fingers.down(2, 300, 300, 2100);
    expectNear(editor.drawn().points[1].at, { x: 200, y: 100 });
    expect(editor.drawn().loupe).toBeNull();
    // The two fingers pinch now, moving the view, not the point.
    fingers.move(1, 260, 160, 2150);
    fingers.up(1, 260, 160, 2200);
    fingers.up(2, 300, 300, 2200);
    expect(editor.shapes()).toEqual(shapes);
    expect(editor.drawn().can).toEqual(undoable);
    editor.undo();
    expect(editor.drawn().points).toHaveLength(1);
  });

  it("a second finger landing while the first holds to place a point cancels the placement", () => {
    const editor = blankPage();
    const fingers = touchscreen(editor);
    fingers.down(1, 100, 100, 0);
    fingers.tick(300);
    expect(editor.drawn().loupe).not.toBeNull();
    fingers.down(2, 300, 300, 400);
    fingers.up(1, 100, 100, 500);
    fingers.up(2, 300, 300, 500);
    expect(editor.drawn()).toMatchObject({ points: [], loupe: null, can: { undo: false } });
  });

  it("a two-finger tap undoes and a three-finger tap redoes", () => {
    const editor = blankPage();
    const fingers = touchscreen(editor);
    twoPoints(fingers);
    fingers.down(1, 50, 300, 2000);
    fingers.down(2, 150, 300, 2030);
    fingers.up(1, 50, 300, 2100);
    fingers.up(2, 150, 300, 2110);
    expect(editor.drawn().points).toHaveLength(1);
    fingers.down(1, 50, 300, 3000);
    fingers.down(2, 150, 300, 3010);
    fingers.down(3, 250, 300, 3020);
    for (const id of [1, 2, 3]) fingers.up(id, 50 + 100 * (id - 1), 300, 3100);
    expect(editor.drawn().points).toHaveLength(2);
  });

  it("a pinch zooms about the fingers' middle and pans with it", () => {
    const editor = blankPage();
    const before = editor.drawn().page;
    // The page spot under the fingers' middle stays under it as they move.
    const under = { x: (200 - before.x) / before.width, y: (200 - before.y) / before.height };
    editor.gesture({ type: "pinch", from: { x: 200, y: 200 }, at: { x: 220, y: 190 }, scale: 2, pointerType: "touch" });
    const after = editor.drawn().page;
    expect(after.width).toBeCloseTo(before.width * 2, 6);
    expectNear({ x: after.x + under.x * after.width, y: after.y + under.y * after.height }, { x: 220, y: 190 });
  });
});
