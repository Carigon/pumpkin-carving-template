import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type HandTrace, type Point, type Shape } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines } from "./outlines";

/** The loader's tolerance on a blank page (5e-4 of its side). */
const TOL = 5e-4;
/** The circles' middle and radius on the page. */
const MIDDLE = { x: 0.5, y: 0.5 };
const R = 0.3;

/** A blank-page hand-trace on a 400 × 400 px canvas holding `shapes`, as a reopened one would. */
function editorWith(...shapes: (Pick<Shape, "points"> & Partial<Pick<Shape, "closed">>)[]): HandTrace {
  const record = {
    shapes: shapes.map((s, i) => ({ id: i + 1, closed: true, mirror: "none" as const, ...s })),
    drawing: null,
    done: false,
  };
  const editor = createHandTrace({ toDesign: designFromPathData, record });
  editor.resize(400, 400);
  return editor;
}

/** `n` points of `kind` round the circle, the first at the right, going anticlockwise. */
function ring(n: number, kind: Point["kind"]): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: MIDDLE.x + R * Math.cos(a), y: MIDDLE.y + R * Math.sin(a), kind };
  });
}

const SQUARE: Point[] = [
  { x: 0.2, y: 0.2, kind: "corner" },
  { x: 0.6, y: 0.2, kind: "corner" },
  { x: 0.6, y: 0.6, kind: "corner" },
  { x: 0.2, y: 0.6, kind: "corner" },
];

/** Where page point `p` (relative to the page, y up) is drawn on screen now. */
function screenOf(editor: HandTrace, p: Point2): Point2 {
  const page = editor.drawn().page;
  return { x: page.x + p.x * page.width, y: page.y + (1 - p.y) * page.height };
}

/** Screen point `s` as a page point. */
function pageOf(editor: HandTrace, s: Point2): Point2 {
  const page = editor.drawn().page;
  return { x: (s.x - page.x) / page.width, y: 1 - (s.y - page.y) / page.height };
}

function tap(editor: HandTrace, at: Point2): void {
  editor.gesture({ type: "tap", at, pointerType: "touch" });
}

const tapPage = (editor: HandTrace, p: Point2) => tap(editor, screenOf(editor, p));

/** A double-tap at screen point `at`: its first tap, then the second as the recognizer reports it. */
function doubleTap(editor: HandTrace, at: Point2): void {
  tap(editor, at);
  editor.gesture({ type: "doubleTap", at, pointerType: "touch" });
}

/** Drag from screen point `from` to `to`, by `pointerType`, with Alt held or not. */
function drag(editor: HandTrace, from: Point2, to: Point2, pointerType: "touch" | "mouse" = "touch", alt = false): void {
  const g = { type: "drag" as const, from, pointerType, ...(alt && { alt }) };
  editor.gesture({ ...g, phase: "start", at: from });
  editor.gesture({ ...g, phase: "move", at: to });
  editor.gesture({ ...g, phase: "end", at: to });
}

/** The drawn handles of `kind`, as page points: each from its point to its tip. */
const handlesOf = (editor: HandTrace, kind: "own" | "neighbour" | "stub") =>
  editor
    .drawn()
    .handles.filter((h) => h.kind === kind)
    .map((h) => ({ from: pageOf(editor, h.from), to: pageOf(editor, h.to) }));

/** The one drawn handle of the selected point whose tip is on `side` of it: the first by `pick`. */
function ownHandle(editor: HandTrace, pick: (to: Point2, from: Point2) => boolean) {
  const found = editor.drawn().handles.filter((h) => h.kind === "own" && pick(h.to, h.from));
  expect(found).toHaveLength(1);
  return found[0];
}

/** The furthest any vertex of the Design lies from the circle, as a fraction of its radius. */
function offCircle(editor: HandTrace): number {
  const paths = editor.design()!.paths;
  return Math.max(...paths.flat().map((p) => Math.abs(Math.hypot(p.x - MIDDLE.x, p.y - MIDDLE.y) - R) / R));
}

/** How far page point `p` is from the Design's outlines. */
function offDesign(paths: Point2[][], p: Point2): number {
  let best = Infinity;
  for (const path of paths) {
    path.forEach((a, i) => {
      const b = path[(i + 1) % path.length];
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    });
  }
  return best;
}

const kinds = (editor: HandTrace) => editor.shapes()[0].points.map((p) => p.kind);
const near = (a: Point2, b: Point2, tol = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe("hand-trace curves: automatic handles", () => {
  it("8 smooth points on a circle trace it within 1%", () => {
    const editor = editorWith({ points: ring(8, "smooth") });
    expect(offCircle(editor)).toBeLessThan(0.01);
  });

  it("a smooth point's two drawn handles are collinear, pointing opposite ways", () => {
    const points: Point[] = [
      { x: 0.2, y: 0.2, kind: "corner" },
      { x: 0.7, y: 0.25, kind: "smooth" },
      { x: 0.5, y: 0.8, kind: "corner" },
    ];
    const editor = editorWith({ points });
    tapPage(editor, points[1]);
    const [h1, h2] = handlesOf(editor, "own").map(({ from, to }) => ({ x: to.x - from.x, y: to.y - from.y }));
    expect(Math.abs(h1.x * h2.y - h1.y * h2.x)).toBeLessThan(1e-9);
    expect(h1.x * h2.x + h1.y * h2.y).toBeLessThan(0);
  });

  it("a mirror-symmetric arrangement gives a mirror-symmetric outline", () => {
    const points: Point[] = [
      { x: 0.3, y: 0.3, kind: "smooth" },
      { x: 0.5, y: 0.15, kind: "corner" },
      { x: 0.7, y: 0.3, kind: "smooth" },
      { x: 0.8, y: 0.7, kind: "smooth" },
      { x: 0.5, y: 0.6, kind: "smooth" },
      { x: 0.2, y: 0.7, kind: "smooth" },
    ];
    const paths = editorWith({ points }).design()!.paths;
    const reflected = paths.map((path) => path.map((p) => ({ x: 1 - p.x, y: p.y })));
    expectSameOutlines(paths, reflected, TOL);
  });

  it("follow their neighbours: moving a neighbour bends the edge", () => {
    const editor = editorWith({ points: ring(4, "smooth") });
    const before = editor.design();
    const top = ring(4, "smooth")[1];
    drag(editor, screenOf(editor, top), screenOf(editor, { x: top.x, y: top.y + 0.1 }));
    const right = editor.shapes()[0].points[0];
    expect(right.in).toBeUndefined();
    expect(right.out).toBeUndefined();
    expect(editor.design()).not.toEqual(before);
  });
});

describe("hand-trace curves: Smooth / Corner", () => {
  it("the pill's Smooth / Corner makes a selected corner smooth with automatic handles: the edges curve", () => {
    const editor = editorWith({ points: SQUARE });
    tapPage(editor, SQUARE[1]);
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: false, smooth: false });
    editor.toggleKind();
    expect(kinds(editor)).toEqual(["corner", "smooth", "corner", "corner"]);
    expect(editor.shapes()[0].points[1]).toEqual({ ...SQUARE[1], kind: "smooth" });
    expect(editor.drawn().pill).toEqual({ kind: "point", canCarryOn: false, smooth: true });
    // Its edges bow away from the square's.
    const away = editor.design()!.paths.flat().map((v) => offDesign([SQUARE], v));
    expect(Math.max(...away)).toBeGreaterThan(0.01);
  });

  it("is one undo step", () => {
    const editor = editorWith({ points: SQUARE });
    tapPage(editor, SQUARE[1]);
    editor.toggleKind();
    editor.undo();
    expect(kinds(editor)).toEqual(["corner", "corner", "corner", "corner"]);
    expect(editor.drawn().can.undo).toBe(false);
  });

  it("the S key toggles the selected point; with nothing selected it does nothing", () => {
    const editor = editorWith({ points: SQUARE });
    expect(editor.key({ key: "s", ctrl: false, shift: false })).toBe(false);
    tapPage(editor, SQUARE[2]);
    expect(editor.key({ key: "s", ctrl: false, shift: false })).toBe(true);
    expect(kinds(editor)[2]).toBe("smooth");
    expect(editor.key({ key: "S", ctrl: false, shift: true })).toBe(true);
    expect(kinds(editor)[2]).toBe("corner");
  });

  it("Corner keeps a smooth point's handles where they were, now independent: the outline doesn't move", () => {
    const editor = editorWith({ points: ring(4, "smooth") });
    const before = editor.design()!;
    tapPage(editor, ring(4, "smooth")[0]);
    editor.toggleKind();
    expect(kinds(editor)[0]).toBe("corner");
    expectSameOutlines(editor.design()!.paths, before.paths, TOL);
    const p = editor.shapes()[0].points[0];
    expect(p.in && p.out).toBeTruthy();
  });

  it("Smooth on a corner with handles points them along their average direction, keeping their lengths", () => {
    const corner: Point = { x: 0.6, y: 0.2, kind: "corner", in: { x: -0.1, y: 0 }, out: { x: 0, y: 0.2 } };
    const editor = editorWith({ points: [SQUARE[0], corner, SQUARE[2], SQUARE[3]] });
    tapPage(editor, corner);
    editor.toggleKind();
    const p = editor.shapes()[0].points[1];
    const k = Math.SQRT1_2;
    expect(p.kind).toBe("smooth");
    expect(p.out!.x).toBeCloseTo(0.2 * k, 12);
    expect(p.out!.y).toBeCloseTo(0.2 * k, 12);
    expect(p.in!.x).toBeCloseTo(-0.1 * k, 12);
    expect(p.in!.y).toBeCloseTo(-0.1 * k, 12);
  });

  describe("double-tap", () => {
    it("a double-tap on a point takes its first tap back and toggles it instead, as one undo step", () => {
      const editor = editorWith({ points: SQUARE });
      doubleTap(editor, screenOf(editor, SQUARE[1]));
      expect(kinds(editor)).toEqual(["corner", "smooth", "corner", "corner"]);
      expect(editor.drawn().points[1].selected).toBe(true);
      editor.undo();
      expect(kinds(editor)[1]).toBe("corner");
      expect(editor.drawn().can.undo).toBe(false);
    });

    it("while drawing, a double-tap on the shape's middle point toggles it and places no point", () => {
      const editor = editorWith();
      for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
      doubleTap(editor, screenOf(editor, SQUARE[1]));
      expect(editor.shapes()[0].points.map((p) => p.kind)).toEqual(["corner", "smooth", "corner"]);
      expect(editor.drawn().pill).toEqual({ kind: "drawing", points: 3, canClose: true });
    });

    it("a double-tap on the first point of the shape being drawn toggles it instead of closing", () => {
      const editor = editorWith();
      for (const p of SQUARE.slice(0, 3)) tapPage(editor, p);
      doubleTap(editor, screenOf(editor, SQUARE[0]));
      expect(editor.shapes()[0]).toMatchObject({ closed: false });
      expect(editor.shapes()[0].points[0].kind).toBe("smooth");
    });

    it("a double-tap away from any point is two taps", () => {
      const editor = editorWith({ points: SQUARE });
      const twice = editorWith({ points: SQUARE });
      const at = screenOf(editor, { x: 0.8, y: 0.8 });
      doubleTap(editor, at);
      tap(twice, at);
      tap(twice, at);
      expect(editor.shapes()).toEqual(twice.shapes());
      expect(editor.drawn().pill).toEqual(twice.drawn().pill);
    });

    it("a double-tap after something else changed is a plain tap", () => {
      const editor = editorWith({ points: SQUARE });
      tapPage(editor, SQUARE[1]);
      editor.toggleKind();
      editor.gesture({ type: "doubleTap", at: screenOf(editor, SQUARE[1]), pointerType: "touch" });
      expect(kinds(editor)[1]).toBe("smooth");
    });
  });
});

describe("hand-trace curves: which handles show", () => {
  it("the selected point's own handles, and its neighbours' on its two edges; nothing else", () => {
    const pts = ring(4, "smooth");
    const editor = editorWith({ points: pts });
    expect(editor.drawn().handles).toEqual([]);
    tapPage(editor, pts[1]);
    const own = handlesOf(editor, "own");
    expect(own).toHaveLength(2);
    expect(own.every((h) => near(h.from, pts[1], 1e-9))).toBe(true);
    const neighbours = handlesOf(editor, "neighbour");
    expect(neighbours).toHaveLength(2);
    // The right point's handle going up, and the left point's coming down to the top.
    expect(neighbours.some((h) => near(h.from, pts[0]) && h.to.y > pts[0].y)).toBe(true);
    expect(neighbours.some((h) => near(h.from, pts[2]) && h.to.y > pts[2].y)).toBe(true);
    expect(handlesOf(editor, "stub")).toEqual([]);
  });

  it("none for a selected whole shape", () => {
    const editor = editorWith({ points: ring(4, "smooth") });
    tapPage(editor, MIDDLE);
    expect(editor.drawn().pill.kind).toBe("shape");
    expect(editor.drawn().handles).toEqual([]);
  });

  it("a selected corner shows a stub 40 px out along each edge with no handle", () => {
    const editor = editorWith({ points: SQUARE });
    tapPage(editor, SQUARE[0]);
    const stubs = editor.drawn().handles.filter((h) => h.kind === "stub");
    expect(stubs).toHaveLength(2);
    const at = screenOf(editor, SQUARE[0]);
    for (const s of stubs) {
      expect(s.from).toEqual(at);
      expect(Math.hypot(s.to.x - at.x, s.to.y - at.y)).toBeCloseTo(40, 6);
    }
    // One along the bottom edge (rightwards) and one up the left edge.
    expect(stubs.some((s) => Math.abs(s.to.y - at.y) < 1e-6 && s.to.x > at.x)).toBe(true);
    expect(stubs.some((s) => Math.abs(s.to.x - at.x) < 1e-6 && s.to.y < at.y)).toBe(true);
  });

  it("an open shape's end corner shows a stub only on the side with an edge", () => {
    const editor = editorWith({ points: SQUARE.slice(0, 3), closed: false });
    tapPage(editor, SQUARE[0]);
    expect(handlesOf(editor, "stub")).toHaveLength(1);
  });
});

describe("hand-trace curves: dragging handles", () => {
  const pts = ring(4, "smooth");
  /** The selected top point's handle reaching right: its `in` one, as the ring runs anticlockwise. */
  const rightward = (to: Point2, from: Point2) => to.x > from.x;

  it("dragging a smooth point's automatic handle stores both, the other turned to stay in line", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = ownHandle(editor, rightward);
    const to = { x: h.to.x + 10, y: h.to.y - 20 };
    drag(editor, h.to, to);
    const p = editor.shapes()[0].points[1];
    const tip = pageOf(editor, to);
    expect(p.kind).toBe("smooth");
    expect(near({ x: p.x + p.in!.x, y: p.y + p.in!.y }, tip, 1e-9)).toBe(true);
    expect(Math.abs(p.out!.x * p.in!.y - p.out!.y * p.in!.x)).toBeLessThan(1e-12);
    expect(p.out!.x * p.in!.x + p.out!.y * p.in!.y).toBeLessThan(0);
    expect(Math.hypot(p.out!.x, p.out!.y)).toBeCloseTo((R * Math.SQRT2) / 3, 9);
  });

  it("a dragged handle stays put when a neighbour moves", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = ownHandle(editor, rightward);
    drag(editor, h.to, { x: h.to.x + 10, y: h.to.y - 20 });
    const before = editor.shapes()[0].points[1];
    drag(editor, screenOf(editor, pts[0]), screenOf(editor, { x: pts[0].x + 0.1, y: pts[0].y }));
    expect(editor.shapes()[0].points[0].x).toBeCloseTo(pts[0].x + 0.1, 9);
    expect(editor.shapes()[0].points[1]).toEqual(before);
  });

  it("is one undo step, and the Design changes only once it ends", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const design = editor.design();
    const h = ownHandle(editor, rightward);
    const g = { type: "drag" as const, from: h.to, pointerType: "touch" as const };
    editor.gesture({ ...g, phase: "start", at: h.to });
    editor.gesture({ ...g, phase: "move", at: { x: h.to.x + 30, y: h.to.y } });
    expect(editor.design()).toBe(design);
    editor.gesture({ ...g, phase: "end", at: { x: h.to.x + 30, y: h.to.y } });
    expect(editor.design()).not.toBe(design);
    editor.undo();
    expectSameOutlines(editor.design()!.paths, design!.paths, 1e-12);
  });

  it("a handle dragged within 10 px of its point is removed: a smooth point becomes a corner keeping its other one", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = ownHandle(editor, rightward);
    drag(editor, h.to, { x: h.from.x + 6, y: h.from.y + 5 });
    const p = editor.shapes()[0].points[1];
    expect(p.kind).toBe("corner");
    expect(p.in).toBeUndefined();
    expect(p.out!.x).toBeCloseTo((-R * Math.SQRT2) / 3, 9);
    expect(p.out!.y).toBeCloseTo(0, 9);
    // That side is straight now, so its corner shows a stub there.
    expect(handlesOf(editor, "stub")).toHaveLength(1);
  });

  it("a corner's handle dragged back onto its point leaves that side straight", () => {
    const corner: Point = { x: 0.6, y: 0.2, kind: "corner", out: { x: 0, y: 0.1 } };
    const editor = editorWith({ points: [SQUARE[0], corner, SQUARE[2], SQUARE[3]] });
    tapPage(editor, corner);
    const h = ownHandle(editor, () => true);
    drag(editor, h.to, h.from);
    expect(editor.shapes()[0].points[1]).toEqual({ x: 0.6, y: 0.2, kind: "corner" });
    expectSameOutlines(editor.design()!.paths, [SQUARE], TOL);
  });

  it("a corner's handle moves alone", () => {
    const corner: Point = { x: 0.6, y: 0.2, kind: "corner", in: { x: -0.1, y: 0 }, out: { x: 0, y: 0.1 } };
    const editor = editorWith({ points: [SQUARE[0], corner, SQUARE[2], SQUARE[3]] });
    tapPage(editor, corner);
    const h = ownHandle(editor, (to, from) => to.y < from.y);
    drag(editor, h.to, { x: h.to.x + 20, y: h.to.y });
    const p = editor.shapes()[0].points[1];
    expect(p.in).toEqual({ x: -0.1, y: 0 });
    expect(p.out!.x).toBeGreaterThan(0);
  });

  it("Alt + drag on a smooth point's handle makes it a corner and moves that handle alone", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const before = editor.shapes()[0].points;
    const h = ownHandle(editor, rightward);
    drag(editor, h.to, { x: h.to.x + 10, y: h.to.y - 30 }, "mouse", true);
    const p = editor.shapes()[0].points[1];
    expect(p.kind).toBe("corner");
    // The other handle is where the automatic one was: a third of the way to the left point, leftwards.
    expect(p.out!.x).toBeCloseTo((-R * Math.SQRT2) / 3, 9);
    expect(p.out!.y).toBeCloseTo(0, 9);
    expect(editor.shapes()[0].points.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
  });

  it("dragging a stub pulls a handle out of the corner", () => {
    const editor = editorWith({ points: SQUARE });
    tapPage(editor, SQUARE[0]);
    const stub = editor.drawn().handles.find((h) => h.kind === "stub" && h.to.x > h.from.x)!;
    const to = { x: stub.to.x + 20, y: stub.to.y - 20 };
    drag(editor, stub.to, to);
    const p = editor.shapes()[0].points[0];
    expect(p.kind).toBe("corner");
    expect(p.in).toBeUndefined();
    expect(near({ x: p.x + p.out!.x, y: p.y + p.out!.y }, pageOf(editor, to), 1e-9)).toBe(true);
    expect(handlesOf(editor, "own")).toHaveLength(1);
    expect(handlesOf(editor, "stub")).toHaveLength(1);
  });

  it("a neighbour's faint handle can be dragged too, which selects its point", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = editor.drawn().handles.find((k) => k.kind === "neighbour")!;
    drag(editor, h.to, { x: h.to.x + 15, y: h.to.y + 15 });
    const selected = editor.drawn().points.findIndex((p) => p.selected);
    expect(near(pageOf(editor, editor.drawn().points[selected].at), pageOf(editor, h.from), 1e-9)).toBe(true);
    expect(selected).not.toBe(1);
  });

  it("a touch drag of a handle shows the loupe centred on the handle's tip; a mouse drag shows none", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = ownHandle(editor, rightward);
    const to = { x: h.to.x + 25, y: h.to.y + 5 };
    const g = { type: "drag" as const, from: h.to, pointerType: "touch" as const };
    editor.gesture({ ...g, phase: "start", at: h.to });
    editor.gesture({ ...g, phase: "move", at: to });
    expect(editor.drawn().loupe!.focus.x).toBeCloseTo(to.x, 9);
    expect(editor.drawn().loupe!.focus.y).toBeCloseTo(to.y, 9);
    editor.gesture({ ...g, phase: "end", at: to });
    expect(editor.drawn().loupe).toBeNull();
    const mouse = { ...g, pointerType: "mouse" as const, from: to };
    editor.gesture({ ...mouse, phase: "start", at: to });
    editor.gesture({ ...mouse, phase: "move", at: h.to });
    expect(editor.drawn().loupe).toBeNull();
  });

  it("points and handles compete: the nearer wins", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = ownHandle(editor, rightward);
    // Nearer the point than the handle's tip: it's the point that moves.
    const from = { x: h.from.x + 4, y: h.from.y };
    drag(editor, from, { x: from.x, y: from.y + 30 });
    expect(editor.shapes()[0].points[1].y).toBeLessThan(pts[1].y);
    expect(editor.shapes()[0].points[1].out).toBeUndefined();
  });

  it("a tap on a handle selects it, and the arrow keys then nudge the handle, as one undo step", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[1]);
    const h = ownHandle(editor, rightward);
    tap(editor, h.to);
    expect(editor.drawn().handles.find((k) => k.selected)).toMatchObject({ kind: "own", to: h.to });
    for (let i = 0; i < 3; i++) editor.key({ key: "ArrowRight", ctrl: false, shift: false });
    const moved = ownHandle(editor, rightward);
    expect(moved.to.x).toBeCloseTo(h.to.x + 3, 9);
    expect(moved.to.y).toBeCloseTo(h.to.y, 9);
    expect(editor.shapes()[0].points[1]).toMatchObject({ x: pts[1].x, y: pts[1].y });
    editor.undo();
    expect(editor.drawn().can.undo).toBe(false);
  });
});

describe("hand-trace curves: inserting and deleting points", () => {
  it("inserting on a curve adds a corner on the curve and leaves the Design unchanged", () => {
    const pts = ring(4, "smooth");
    const editor = editorWith({ points: pts });
    const before = editor.design()!;
    tapPage(editor, pts[0]);
    const markers = editor.drawn().markers;
    expect(markers).toHaveLength(4);
    tap(editor, markers[0]);
    const shape = editor.shapes()[0];
    expect(shape.points).toHaveLength(5);
    const added = shape.points.find((p) => p.kind === "corner")!;
    expect(offDesign(before.paths, added)).toBeLessThan(TOL);
    expectSameOutlines(editor.design()!.paths, before.paths, TOL);
  });

  it("insert markers sit on the curve's middle", () => {
    const pts = ring(4, "smooth");
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[0]);
    for (const m of editor.drawn().markers) {
      const p = pageOf(editor, m);
      expect(offDesign(editor.design()!.paths, p)).toBeLessThan(TOL);
    }
  });

  it("inserting on a straight edge changes nothing else", () => {
    const corner: Point = { x: 0.6, y: 0.6, kind: "smooth" };
    const editor = editorWith({ points: [SQUARE[0], SQUARE[1], corner, SQUARE[3]] });
    tapPage(editor, SQUARE[0]);
    const before = editor.shapes()[0].points;
    // The bottom edge, between two corners with no handles.
    const marker = editor.drawn().markers.find((m) => Math.abs(pageOf(editor, m).y - 0.2) < 1e-9)!;
    tap(editor, marker);
    const after = editor.shapes()[0].points;
    expect(after).toEqual([before[0], { x: 0.4, y: 0.2, kind: "corner" }, ...before.slice(1)]);
  });

  it("deleting a point between two straight edges gives exactly the straight edge", () => {
    const extra: Point = { x: 0.4, y: 0.1, kind: "corner" };
    const smooth: Point = { x: 0.6, y: 0.6, kind: "smooth" };
    const editor = editorWith({ points: [SQUARE[0], extra, SQUARE[1], smooth, SQUARE[3]] });
    const without = editorWith({ points: [SQUARE[0], SQUARE[1], smooth, SQUARE[3]] }).design()!;
    tapPage(editor, extra);
    editor.delete();
    expectSameOutlines(editor.design()!.paths, without.paths, 1e-12);
  });

  it("deleting one of 8 smooth points on a circle stays within 2% of the radius, other points keeping place and kind", () => {
    const pts = ring(8, "smooth");
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[2]);
    editor.delete();
    expect(offCircle(editor)).toBeLessThan(0.02);
    const kept = editor.shapes()[0].points;
    expect(kept.map(({ x, y, kind }) => ({ x, y, kind }))).toEqual(pts.filter((_, i) => i !== 2));
  });

  it("deleting a corner between two curved edges refits one curve close to both", () => {
    const pts = ring(8, "smooth").map((p, i) => (i === 2 ? { ...p, kind: "corner" as const } : p));
    const editor = editorWith({ points: pts });
    tapPage(editor, pts[2]);
    editor.delete();
    expect(offCircle(editor)).toBeLessThan(0.05);
  });
});

describe("hand-trace curves: hits along the curve", () => {
  const pts = ring(4, "smooth");
  /** On the circle half-way between the right and top points: well outside the straight line between them. */
  const onArc = { x: MIDDLE.x + R * Math.SQRT1_2, y: MIDDLE.y + R * Math.SQRT1_2 };

  it("a tap on a curved outline, away from the straight line between its points, selects the shape", () => {
    const editor = editorWith({ points: pts });
    tapPage(editor, onArc);
    expect(editor.drawn().pill.kind).toBe("shape");
  });

  it("a tap inside the curve but outside the straight lines between its points selects the shape", () => {
    const editor = editorWith({ points: pts });
    const inside = { x: MIDDLE.x + 0.8 * R * Math.SQRT1_2, y: MIDDLE.y + 0.8 * R * Math.SQRT1_2 };
    // Zoomed in so it's more than the hit radius from the outline and from the straight line between the points.
    for (let i = 0; i < 4; i++) editor.key({ key: "+", ctrl: false, shift: false });
    tapPage(editor, inside);
    expect(editor.drawn().pill.kind).toBe("shape");
  });

  it("insert markers hide on edges shorter than 48 px measured along the curve", () => {
    // A straight chord of 44 px whose curve bulges well out: long enough along the curve.
    const s = 44 / 376;
    const lens: Point[] = [
      { x: 0.5, y: 0.5, kind: "corner", out: { x: 0, y: 0.08 } },
      { x: 0.5 + s, y: 0.5, kind: "corner", in: { x: 0, y: 0.08 } },
      { x: 0.5 + s / 2, y: 0.2, kind: "corner" },
    ];
    const editor = editorWith({ points: lens });
    tapPage(editor, { x: 0.5 + s / 2, y: 0.35 });
    expect(editor.drawn().pill.kind).toBe("shape");
    expect(editor.drawn().markers).toHaveLength(3);
  });
});

describe("hand-trace curves: the Design", () => {
  it("a figure-eight with equal loops is carved: only shapes enclosing no area drop out", () => {
    const bowTie: Point[] = [
      { x: 0.2, y: 0.3, kind: "corner" },
      { x: 0.8, y: 0.7, kind: "corner" },
      { x: 0.8, y: 0.3, kind: "corner" },
      { x: 0.2, y: 0.7, kind: "corner" },
    ];
    expect(editorWith({ points: bowTie }).design()).not.toBeNull();
    const flat: Point[] = [
      { x: 0.2, y: 0.3, kind: "corner" },
      { x: 0.8, y: 0.3, kind: "corner" },
      { x: 0.5, y: 0.3, kind: "corner" },
    ];
    expect(editorWith({ points: flat }).design()).toBeNull();
  });

  it("a hand-trace's curves survive the stored record", () => {
    const editor = editorWith({ points: ring(4, "smooth") });
    const reopened = createHandTrace({ toDesign: designFromPathData, record: editor.record() });
    expectSameOutlines(reopened.design()!.paths, editor.design()!.paths, 1e-12);
  });
});
