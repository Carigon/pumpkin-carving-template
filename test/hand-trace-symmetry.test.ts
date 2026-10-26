import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type HandTrace, type HandTraceRecord, type Shape } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines, outlinesOf } from "./outlines";

/** The loader's tolerance on a blank page (5e-4 of its side). */
const TOL = 5e-4;
/** The canvas, in px: the 1 × 1 blank page fits it at 94%, so a page unit is 376 px. */
const SIZE = 400;
const PX = 1 / (0.94 * SIZE);

/** A blank-page hand-trace on a 400 × 400 px canvas, reopened from `record` when given. */
function blankPage(record?: Partial<HandTraceRecord>): HandTrace {
  const editor = createHandTrace({
    toDesign: designFromPathData,
    ...(record && { record: { shapes: [], drawing: null, done: false, ...record } }),
  });
  editor.resize(SIZE, SIZE);
  return editor;
}

/** A blank page holding `shapes` (ids from 1, closed unless said), as a reopened hand-trace would. */
function editorWith(...shapes: (Pick<Shape, "points" | "mirror"> & Partial<Pick<Shape, "closed">>)[]): HandTrace {
  return blankPage({ shapes: shapes.map((s, i) => ({ id: i + 1, closed: true, ...s })) });
}

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

const tap = (editor: HandTrace, at: Point2) => editor.gesture({ type: "tap", at, pointerType: "touch" });
const tapPage = (editor: HandTrace, p: Point2) => tap(editor, screenOf(editor, p));

/** Tap each of `points`, then the first again to close. */
function drawClosed(editor: HandTrace, points: Point2[]): void {
  for (const p of [...points, points[0]]) tapPage(editor, p);
}

/** Drag from screen point `from` to `to`, by touch; `moves` lists the screen points it passes on the way. */
function drag(editor: HandTrace, from: Point2, to: Point2, moves: Point2[] = []): void {
  const g = { type: "drag" as const, from, pointerType: "touch" as const };
  editor.gesture({ ...g, phase: "start", at: from });
  for (const at of [...moves, to]) editor.gesture({ ...g, phase: "move", at });
  editor.gesture({ ...g, phase: "end", at: to });
}

/** Drag from page point `from` by `dx`, `dy` page units (y up). */
const dragPage = (editor: HandTrace, from: Point2, dx: number, dy: number) =>
  drag(editor, screenOf(editor, from), screenOf(editor, { x: from.x + dx, y: from.y + dy }));

const key = (editor: HandTrace, k: string, shift = false) => editor.key({ key: k, ctrl: false, shift });

/** `points` reflected in the symmetry axis (x = 0.5 on a blank page). */
const reflect = (points: Point2[]): Point2[] => points.map((p) => ({ x: 1 - p.x, y: p.y }));

/** The drawn points, as page points. */
const drawnPoints = (editor: HandTrace) => editor.drawn().points.map((p) => pageOf(editor, p.at));

const near = (a: Point2, b: Point2, tol = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/** An eye's corners on the left of the axis. */
const EYE: Point2[] = [
  { x: 0.2, y: 0.6 },
  { x: 0.35, y: 0.6 },
  { x: 0.35, y: 0.75 },
  { x: 0.2, y: 0.75 },
];

/**
 * Half a mouth, axis to axis down the left: its top and bottom middles on the axis, two corners off it. Whole, with
 * its reflection, it's a hexagon.
 */
const HALF_MOUTH: Point2[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.3, y: 0.45 },
  { x: 0.35, y: 0.3 },
  { x: 0.5, y: 0.25 },
];
const MOUTH: Point2[] = [...HALF_MOUTH, ...reflect(HALF_MOUTH.slice(1, 3)).reverse()];

/** `points` from index `start` round to just before it. */
const from = (points: Point2[], start: number) => [...points.slice(start), ...points.slice(0, start)];

describe("hand-trace symmetry: twins and symmetric shapes", () => {
  it("an open mirrored shape is a twin: its reflection is drawn open beside it, and nothing is carved", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    for (const p of EYE.slice(0, 3)) tapPage(editor, p);
    editor.end();
    const [shape] = editor.drawn().shapes;
    expect(shape.closed).toBe(false);
    expect(outlinesOf(shape.d)).toHaveLength(2);
    const drawn = drawnPoints(editor);
    for (const p of [...EYE.slice(0, 3), ...reflect(EYE.slice(0, 3))]) expect(drawn.some((q) => near(q, p))).toBe(true);
    expect(editor.design()).toBeNull();
  });

  it("a twin touching the axis at only one point stays a twin when it closes", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    const triangle = [
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.4 },
      { x: 0.3, y: 0.5 },
    ];
    drawClosed(editor, triangle);
    expectSameOutlines(editor.design()!.paths, [triangle, reflect(triangle)], TOL);
  });

  it.each([1, 2, 3])(
    "half a mouth started at its point %i closes as one symmetric shape when its outline runs along the axis",
    (start) => {
      const editor = blankPage();
      editor.toggleSymmetry();
      drawClosed(editor, from(HALF_MOUTH, start));
      expect(editor.drawn().pill.kind).toBe("hint");
      expectSameOutlines(editor.design()!.paths, [MOUTH], TOL);
      // Stored from just after the edge on the axis: the half runs axis to axis.
      const [stored] = editor.record().shapes;
      expect(stored.mirror).toBe("symmetric");
      expect([stored.points[0].x, stored.points.at(-1)!.x]).toEqual([0.5, 0.5]);
    },
  );

  it("started on the axis, it closes by itself as it lands on the axis again", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    for (const p of HALF_MOUTH) tapPage(editor, p);
    expect(editor.drawn().pill.kind).toBe("hint");
    expectSameOutlines(editor.design()!.paths, [MOUTH], TOL);
    editor.undo();
    expect(editor.drawn().pill).toMatchObject({ kind: "drawing", points: 3 });
  });

  it("landing on the axis a second point in, it carries on: there's nothing off the axis to mirror yet", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    tapPage(editor, { x: 0.5, y: 0.5 });
    tapPage(editor, { x: 0.5, y: 0.4 });
    expect(editor.drawn().pill).toMatchObject({ kind: "drawing", points: 2 });
  });

  it("an unmirrored shape with an edge on the axis closes as itself", () => {
    const editor = blankPage();
    drawClosed(editor, HALF_MOUTH);
    expectSameOutlines(editor.design()!.paths, [HALF_MOUTH], TOL);
  });

  it("a smooth point on the axis crosses it smoothly (a smooth join), a corner one makes a cusp (a heart's dip)", () => {
    const top = { x: 0.5, y: 0.6 };
    // A heart's half: its lobe rises above the axis point at the top.
    const half = (kind: "corner" | "smooth") => [
      { x: 0.5, y: 0.3, kind: "corner" as const },
      { x: 0.3, y: 0.65, kind: "smooth" as const },
      { ...top, kind },
    ];
    for (const kind of ["smooth", "corner"] as const) {
      const editor = editorWith({ mirror: "symmetric", points: half(kind) });
      const [outline] = editor.design()!.paths;
      // The outline's vertices either side of the top: level with it when smooth, above it at a cusp.
      const i = outline.findIndex((p) => near(p, top, 1e-3));
      const [before, after] = [outline.at(i - 1)!, outline[(i + 1) % outline.length]];
      const rise = ((before.y + after.y) / 2 - top.y) / Math.hypot(after.x - before.x, after.y - before.y);
      if (kind === "smooth") expect(Math.abs(rise)).toBeLessThan(0.05);
      else expect(rise).toBeGreaterThan(0.2);
    }
  });
});

/** A mirrored triangle on the left, its first point `x` from the axis's left: for snap and clamp tests. */
function mirroredTriangle(gap = 0.1): HandTrace {
  return editorWith({
    mirror: "twin",
    points: [
      { x: 0.5 - gap, y: 0.4, kind: "corner" },
      { x: 0.25, y: 0.3, kind: "corner" },
      { x: 0.25, y: 0.5, kind: "corner" },
    ],
  });
}

describe("hand-trace symmetry: the axis snap", () => {
  it("a point placed within 22 px of the axis for a mirrored shape lands on it", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    tapPage(editor, { x: 0.5 + 15 * PX, y: 0.5 });
    expect(editor.shapes()[0].points[0].x).toBe(0.5);
  });

  it("further off, it stays where it's placed", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    tapPage(editor, { x: 0.5 + 30 * PX, y: 0.5 });
    expect(editor.shapes()[0].points[0].x).toBeCloseTo(0.5 + 30 * PX, 6);
  });

  it("an unmirrored shape never snaps", () => {
    const editor = blankPage();
    tapPage(editor, { x: 0.5 + 5 * PX, y: 0.5 });
    expect(editor.shapes()[0].points[0].x).toBeCloseTo(0.5 + 5 * PX, 6);
    const shape = mirroredTriangle();
    const unmirrored = editorWith({ mirror: "none", points: shape.shapes()[0].points });
    dragPage(unmirrored, { x: 0.4, y: 0.4 }, 0.1 - 5 * PX, 0);
    expect(unmirrored.shapes()[0].points[0].x).toBeCloseTo(0.5 - 5 * PX, 6);
  });

  it("a dragged point snaps on, highlighting the axis, and stays snapped until dragged clearly past", () => {
    const editor = mirroredTriangle();
    const from = screenOf(editor, { x: 0.4, y: 0.4 });
    const at = (px: number) => screenOf(editor, { x: 0.5 - px * PX, y: 0.4 });
    const g = { type: "drag" as const, from, pointerType: "touch" as const };
    editor.gesture({ ...g, phase: "start", at: from });
    editor.gesture({ ...g, phase: "move", at: at(15) });
    expect(editor.drawn().axis?.snapped).toBe(true);
    expect(editor.drawn().points.some((p) => near(pageOf(editor, p.at), { x: 0.5, y: 0.4 }))).toBe(true);
    editor.gesture({ ...g, phase: "move", at: at(28) });
    expect(editor.drawn().axis?.snapped).toBe(true);
    editor.gesture({ ...g, phase: "move", at: at(40) });
    expect(editor.drawn().axis?.snapped).toBe(false);
    editor.gesture({ ...g, phase: "move", at: at(28) });
    editor.gesture({ ...g, phase: "end", at: at(28) });
    expect(editor.shapes()[0].points[0].x).toBeCloseTo(0.5 - 28 * PX, 6);
    expect(editor.drawn().axis?.snapped).toBe(false);
  });

  it("while drawing with a mouse, the hover shows the snap: the axis highlights and the rubber band ends on it", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    tapPage(editor, { x: 0.3, y: 0.3 });
    editor.gesture({ type: "hover", at: screenOf(editor, { x: 0.5 - 10 * PX, y: 0.5 }), pointerType: "mouse", pans: false });
    const { axis, rubberBand } = editor.drawn();
    expect(axis?.snapped).toBe(true);
    expect(pageOf(editor, rubberBand!.to).x).toBeCloseTo(0.5, 9);
  });
});

describe("hand-trace symmetry: each side kept to its side", () => {
  it("a mirrored shape's point dragged across the axis stops on it", () => {
    const editor = mirroredTriangle();
    dragPage(editor, { x: 0.25, y: 0.3 }, 0.5, 0);
    expect(editor.shapes()[0].points[1].x).toBe(0.5);
  });

  it("a point placed across the axis while drawing a mirrored shape lands on it", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    tapPage(editor, { x: 0.3, y: 0.3 });
    tapPage(editor, { x: 0.8, y: 0.4 });
    expect(editor.shapes()[0].points[1].x).toBe(0.5);
  });

  it("the side is set by the first point off the axis: one started on it can go either way", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    tapPage(editor, { x: 0.5, y: 0.3 });
    tapPage(editor, { x: 0.8, y: 0.4 });
    tapPage(editor, { x: 0.2, y: 0.5 });
    expect(editor.shapes()[0].points.map((p) => p.x)).toEqual([0.5, expect.closeTo(0.8, 6), 0.5]);
  });

  it("a twin dragged whole stops at the axis", () => {
    const editor = mirroredTriangle();
    tapPage(editor, { x: 0.3, y: 0.4 });
    dragPage(editor, { x: 0.3, y: 0.4 }, 0.3, 0);
    expect(Math.max(...editor.shapes()[0].points.map((p) => p.x))).toBeCloseTo(0.5, 9);
  });

  it("a handle may cross the axis: handles are kept only to the page", () => {
    const editor = mirroredTriangle();
    tapPage(editor, { x: 0.4, y: 0.4 });
    const stub = editor.drawn().handles.find((h) => h.kind === "stub" && h.to.y < h.from.y)!;
    drag(editor, stub.to, screenOf(editor, { x: 0.7, y: 0.6 }));
    const tips = editor.drawn().handles.filter((h) => h.kind === "own").map((h) => pageOf(editor, h.to));
    expect(tips.some((t) => near(t, { x: 0.7, y: 0.6 }, 1e-6))).toBe(true);
  });
});

/** A twin eye, closed, and its reflection's corners. */
const twinEye = () => editorWith({ mirror: "twin", points: EYE.map((p) => ({ ...p, kind: "corner" as const })) });
const EYE_REFLECTED = reflect(EYE);

/** A symmetric mouth, its half stored axis to axis. */
const mouth = () => editorWith({ mirror: "symmetric", points: HALF_MOUTH.map((p) => ({ ...p, kind: "corner" as const })) });

describe("hand-trace symmetry: editing either side", () => {
  it("a tap on a reflected point selects it there, as the drawn side's would", () => {
    const editor = twinEye();
    tapPage(editor, EYE_REFLECTED[1]);
    const { pill, points } = editor.drawn();
    expect(pill.kind).toBe("point");
    const selected = points.filter((p) => p.selected).map((p) => pageOf(editor, p.at));
    expect(selected).toHaveLength(1);
    expect(near(selected[0], EYE_REFLECTED[1])).toBe(true);
  });

  it("a reflected point dragged follows the finger, its source moving the mirrored way, as one undo step", () => {
    const editor = twinEye();
    dragPage(editor, EYE_REFLECTED[1], 0.05, 0.02);
    const moved = { x: EYE_REFLECTED[1].x + 0.05, y: EYE_REFLECTED[1].y + 0.02 };
    const want = [...EYE];
    want[1] = reflect([moved])[0];
    expectSameOutlines(editor.design()!.paths, [want, reflect(want)], TOL);
    editor.undo();
    expectSameOutlines(editor.design()!.paths, [EYE, EYE_REFLECTED], TOL);
    expect(editor.drawn().can.undo).toBe(false);
  });

  it("a twin selected and dragged by its reflection moves the way the finger goes", () => {
    const editor = twinEye();
    // The reflection's middle, clear of its insert markers.
    const inside = { x: 0.725, y: 0.675 };
    tapPage(editor, inside);
    expect(editor.drawn().pill.kind).toBe("shape");
    dragPage(editor, inside, 0.05, -0.1);
    const want = EYE_REFLECTED.map((p) => ({ x: p.x + 0.05, y: p.y - 0.1 }));
    expectSameOutlines(editor.design()!.paths, [want, reflect(want)], TOL);
  });

  it("a symmetric shape dragged whole moves only up and down, staying centred on the axis", () => {
    const editor = mouth();
    const inside = { x: 0.55, y: 0.4 };
    tapPage(editor, inside);
    dragPage(editor, inside, 0.1, 0.1);
    const want = MOUTH.map((p) => ({ x: p.x, y: p.y + 0.1 }));
    expectSameOutlines(editor.design()!.paths, [want], TOL);
  });

  it("deleting a reflected point deletes its source", () => {
    const editor = twinEye();
    tapPage(editor, EYE_REFLECTED[2]);
    editor.delete();
    const want = EYE.filter((_, i) => i !== 2);
    expectSameOutlines(editor.design()!.paths, [want, reflect(want)], TOL);
  });

  it("deleting a mirrored shape removes both sides, as one undo step", () => {
    const editor = twinEye();
    tapPage(editor, { x: 0.7, y: 0.65 });
    editor.delete();
    expect(editor.design()).toBeNull();
    expect(editor.drawn().points).toEqual([]);
    editor.undo();
    expectSameOutlines(editor.design()!.paths, [EYE, EYE_REFLECTED], TOL);
  });

  it("a reflection's insert marker dragged adds a point under the finger, mirrored on the drawn side", () => {
    const editor = twinEye();
    tapPage(editor, { x: 0.725, y: 0.675 });
    // The reflection's bottom edge, from (0.8, 0.6) to (0.65, 0.6).
    const marker = editor.drawn().markers.find((m) => near(pageOf(editor, m), { x: 0.725, y: 0.6 }));
    expect(marker).toBeDefined();
    drag(editor, marker!, screenOf(editor, { x: 0.725, y: 0.55 }));
    const want = [EYE[0], { x: 0.275, y: 0.55 }, ...EYE.slice(1)];
    expectSameOutlines(editor.design()!.paths, [want, reflect(want)], TOL);
  });

  it("a symmetric shape's insert markers include its reflected half's", () => {
    const editor = mouth();
    tapPage(editor, HALF_MOUTH[1]);
    const markers = editor.drawn().markers.map((m) => pageOf(editor, m));
    const mid = (a: Point2, b: Point2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    for (let i = 0; i + 1 < MOUTH.length; i++) expect(markers.some((m) => near(m, mid(MOUTH[i], MOUTH[i + 1])))).toBe(true);
    expect(markers).toHaveLength(MOUTH.length);
  });

  it("a symmetric shape's join across the axis has a marker too, adding a point on the axis there", () => {
    // Its half ends off the axis at the top: joined straight across to its reflection.
    const half = HALF_MOUTH.slice(1).map((p) => ({ ...p, kind: "corner" as const }));
    const editor = editorWith({ mirror: "symmetric", points: half });
    tapPage(editor, half[0]);
    const join = editor.drawn().markers.find((m) => near(pageOf(editor, m), { x: 0.5, y: 0.45 }));
    expect(join).toBeDefined();
    drag(editor, join!, screenOf(editor, { x: 0.5, y: 0.55 }));
    const want = [{ x: 0.5, y: 0.55 }, ...half, ...reflect(half).reverse()];
    expectSameOutlines(editor.design()!.paths, [want], TOL);
  });

  it("a handle on a reflection dragged follows the finger", () => {
    const editor = twinEye();
    tapPage(editor, EYE_REFLECTED[1]);
    const stub = editor.drawn().handles.find((h) => h.kind === "stub")!;
    const to = { x: pageOf(editor, stub.to).x + 0.03, y: pageOf(editor, stub.to).y + 0.04 };
    drag(editor, stub.to, screenOf(editor, to));
    const tips = editor.drawn().handles.filter((h) => h.kind === "own").map((h) => pageOf(editor, h.to));
    expect(tips.some((t) => near(t, to, 1e-6))).toBe(true);
    // The drawn side's handle is its mirror image: the Design stays symmetric.
    const paths = editor.design()!.paths;
    expectSameOutlines(paths, paths.map(reflect), TOL);
  });

  it("an arrow key nudges a reflected point the way the arrow points", () => {
    const editor = twinEye();
    tapPage(editor, EYE_REFLECTED[1]);
    key(editor, "ArrowRight", true);
    const selected = pageOf(editor, editor.drawn().points.find((p) => p.selected)!.at);
    expect(selected.x).toBeCloseTo(EYE_REFLECTED[1].x + 10 * PX, 6);
  });
});

describe("hand-trace symmetry: the small-shape rule counts a symmetric shape whole", () => {
  it("a half left with no point off the axis encloses nothing, so the shape goes", () => {
    const half = [
      { x: 0.5, y: 0.5, kind: "corner" as const },
      { x: 0.3, y: 0.4, kind: "corner" as const },
      { x: 0.5, y: 0.3, kind: "corner" as const },
    ];
    const editor = editorWith({ mirror: "symmetric", points: half });
    tapPage(editor, half[1]);
    editor.delete();
    expect(editor.shapes()).toEqual([]);
  });

  it("a half of two points, one off the axis, is still a triangle whole, so it stays", () => {
    const half = [
      { x: 0.5, y: 0.5, kind: "corner" as const },
      { x: 0.3, y: 0.4, kind: "corner" as const },
      { x: 0.5, y: 0.3, kind: "corner" as const },
    ];
    const editor = editorWith({ mirror: "symmetric", points: half });
    tapPage(editor, half[0]);
    editor.delete();
    expectSameOutlines(editor.design()!.paths, [[half[1], half[2], { x: 0.7, y: 0.4 }]], TOL);
  });
});

describe("hand-trace symmetry: a symmetric shape's points on the axis", () => {
  /** A U-shaped mouth's half: smooth at its bottom middle on the axis. */
  const U = [
    { x: 0.5, y: 0.6, kind: "corner" as const },
    { x: 0.3, y: 0.6, kind: "corner" as const },
    { x: 0.5, y: 0.3, kind: "smooth" as const },
  ];

  it("a smooth axis point's handle slides only at right angles to the axis, so the join stays smooth", () => {
    const editor = editorWith({ mirror: "symmetric", points: U });
    tapPage(editor, U[2]);
    const [own] = editor.drawn().handles.filter((h) => h.kind === "own");
    drag(editor, own.to, { x: own.to.x - 30, y: own.to.y - 40 });
    for (const h of editor.drawn().handles.filter((h) => h.kind === "own")) expect(h.to.y).toBeCloseTo(h.from.y, 6);
    expect(editor.drawn().pill).toMatchObject({ kind: "point", smooth: true });
  });

  it("a corner axis point's handle is free: the join is a cusp", () => {
    const corner = U.map((p) => ({ ...p, kind: "corner" as const }));
    const editor = editorWith({ mirror: "symmetric", points: corner });
    tapPage(editor, U[2]);
    const stub = editor.drawn().handles.find((h) => h.kind === "stub")!;
    const to = { x: stub.to.x - 20, y: stub.to.y - 40 };
    drag(editor, stub.to, to);
    const tips = editor.drawn().handles.filter((h) => h.kind === "own").map((h) => h.to);
    expect(tips.some((t) => Math.hypot(t.x - to.x, t.y - to.y) < 1e-6)).toBe(true);
  });

  it("switching a corner axis point with a handle to Smooth levels its handle", () => {
    const tilted = [...U.slice(0, 2), { ...U[2], kind: "corner" as const, in: { x: -0.1, y: 0.05 } }];
    const editor = editorWith({ mirror: "symmetric", points: tilted });
    tapPage(editor, U[2]);
    editor.toggleKind();
    const own = editor.drawn().handles.filter((h) => h.kind === "own");
    expect(own.length).toBeGreaterThan(0);
    for (const h of own) expect(h.to.y).toBeCloseTo(h.from.y, 6);
  });
});

describe("hand-trace symmetry: the Design's box", () => {
  it("with a mirrored shape, it's widened evenly about the axis, so the axis lands on the pumpkin's front", () => {
    const editor = mouth();
    const wink = [
      { x: 0.8, y: 0.7 },
      { x: 0.9, y: 0.7 },
      { x: 0.85, y: 0.8 },
    ];
    drawClosed(editor, wink);
    const { minX, maxX } = editor.design()!.bbox;
    expect((minX + maxX) / 2).toBeCloseTo(0.5, 9);
    expect(maxX).toBeCloseTo(0.9, 9);
  });

  it("with none, it's the shapes' own box", () => {
    const editor = blankPage();
    drawClosed(editor, EYE);
    const { minX, maxX } = editor.design()!.bbox;
    expect([minX, maxX]).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.35, 6)]);
  });
});

describe("hand-trace symmetry: the axis over a photo", () => {
  const overPhoto = (record?: Partial<HandTraceRecord>) => {
    const editor = createHandTrace({
      toDesign: designFromPathData,
      page: { width: 1, height: 0.75 },
      photo: true,
      ...(record && { record: { shapes: [], drawing: null, done: false, ...record } }),
    });
    editor.resize(SIZE, SIZE);
    return editor;
  };

  it("shows while Symmetry is on, down the photo's middle", () => {
    const editor = overPhoto();
    expect(editor.drawn().axis).toBeNull();
    editor.toggleSymmetry();
    const { axis, page } = editor.drawn();
    expect(axis?.from.x).toBeCloseTo(page.x + page.width / 2, 9);
  });

  it("shows while a mirrored shape is selected, with Symmetry off", () => {
    const points = EYE.map((p) => ({ x: p.x, y: p.y - 0.1, kind: "corner" as const }));
    const editor = overPhoto({ shapes: [{ id: 1, closed: true, mirror: "twin", points }] });
    expect(editor.drawn().axis).toBeNull();
    const { page } = editor.drawn();
    // The photo's design space is 1 × 0.75.
    tap(editor, { x: page.x + points[0].x * page.width, y: page.y + ((0.75 - points[0].y) / 0.75) * page.height });
    expect(editor.drawn().pill.kind).toBe("point");
    expect(editor.drawn().axis).not.toBeNull();
  });
});

describe("hand-trace symmetry: the setting", () => {
  it("with Symmetry on, a shape drawn on one side gets a twin: the Design carves both", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    drawClosed(editor, EYE);
    expectSameOutlines(editor.design()!.paths, [EYE, reflect(EYE)], TOL);
  });

  it("is off to start with: a shape is carved as drawn, alone", () => {
    const editor = blankPage();
    expect(editor.drawn().symmetry).toBe(false);
    drawClosed(editor, EYE);
    expectSameOutlines(editor.design()!.paths, [EYE], TOL);
  });

  it("the M key switches it, either case, and turning it off leaves shapes already drawn mirrored", () => {
    const editor = blankPage();
    expect(key(editor, "m")).toBe(true);
    expect(editor.drawn().symmetry).toBe(true);
    drawClosed(editor, EYE);
    expect(key(editor, "M")).toBe(true);
    expect(editor.drawn().symmetry).toBe(false);
    const wink = [
      { x: 0.6, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.65, y: 0.4 },
    ];
    drawClosed(editor, wink);
    expectSameOutlines(editor.design()!.paths, [EYE, reflect(EYE), wink], TOL);
  });

  it("stamps only shapes as they're started: turning it on mid-shape leaves that shape unmirrored", () => {
    const editor = blankPage();
    tapPage(editor, EYE[0]);
    editor.toggleSymmetry();
    for (const p of [...EYE.slice(1), EYE[0]]) tapPage(editor, p);
    expectSameOutlines(editor.design()!.paths, [EYE], TOL);
  });

  it("isn't an undo step", () => {
    const editor = blankPage();
    editor.toggleSymmetry();
    expect(editor.drawn().can.undo).toBe(false);
  });

  it("is kept in the record, and a reopened hand-trace has it", () => {
    const editor = blankPage();
    const before = editor.record();
    editor.toggleSymmetry();
    expect(editor.record()).not.toBe(before);
    expect(editor.record().symmetry).toBe(true);
    const again = blankPage(editor.record());
    expect(again.drawn().symmetry).toBe(true);
    drawClosed(again, EYE);
    expectSameOutlines(again.design()!.paths, [EYE, reflect(EYE)], TOL);
  });

  it("doesn't switch once Done", () => {
    const editor = blankPage();
    editor.done();
    editor.toggleSymmetry();
    expect(key(editor, "m")).toBe(false);
    expect(editor.drawn().symmetry).toBe(false);
  });
});
