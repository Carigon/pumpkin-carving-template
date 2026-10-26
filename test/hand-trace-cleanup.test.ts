import { describe, expect, it } from "vitest";
import type { Point2 } from "../src/core";
import { createHandTrace, type HandTrace, type Point, type Shape } from "../src/handTrace";
import {
  carryPoints,
  cleanUp,
  designToPhoto,
  photoPage,
  rotateFrame,
  turnFrame,
  WHOLE_PHOTO,
  type Cleanup,
  type FrameCorners,
} from "../src/input/cleanupFrame";
import { designFromPathData } from "../src/input/pathDesign";
import { expectSameOutlines, outlinesOf } from "./outlines";

/** A small photo's size in px, so no cleaned-up photo is shrunk (or rounded) on the way. */
const PHOTO = { width: 400, height: 300 };
/** The whole photo as it is. */
const WHOLE: Cleanup = { corners: WHOLE_PHOTO, aspect: "estimated" };

/** Frame corners at these photo px, clockwise from the cleaned-up photo's top-left. */
function frameAt(...px: [number, number][]): FrameCorners {
  return px.map(([x, y]) => ({ x: x / PHOTO.width, y: y / PHOTO.height })) as unknown as FrameCorners;
}
/** A crop: the frame square on the photo, from photo px (`left`, `top`) to (`right`, `bottom`). */
function crop(left: number, top: number, right: number, bottom: number): Cleanup {
  return { corners: frameAt([left, top], [right, top], [right, bottom], [left, bottom]), aspect: "estimated" };
}

const cleaned = (c: Cleanup) => cleanUp(c, PHOTO);
/** Where design-space position `p` under cleanup `c` is on the photo, px: what a point stays on through a change. */
const onPhoto = (c: Cleanup, p: Point2) => designToPhoto(cleaned(c), p);

/** A hand-trace over the photo cleaned up by `start`, holding `shapes`, on a 400 × 400 px canvas. */
function overPhoto(start: Cleanup, ...shapes: Shape[]): HandTrace<Cleanup> {
  const editor = createHandTrace<Cleanup>({
    toDesign: designFromPathData,
    photo: true,
    cleanup: {
      start,
      page: (c) => photoPage(cleaned(c)),
      carry: (from, to) => carryPoints(cleaned(from), cleaned(to)),
    },
    record: { shapes, drawing: null, done: false },
  });
  editor.resize(400, 400);
  return editor;
}

/** A closed shape of corners at these design-space positions. */
function corners(id: number, ...at: [number, number][]): Shape {
  return { id, closed: true, mirror: "none", points: at.map(([x, y]): Point => ({ x, y, kind: "corner" })) };
}

/** Every point's spot on the photo, under cleanup `c`. */
const spots = (editor: HandTrace<Cleanup>, c: Cleanup) => editor.shapes().flatMap((s) => s.points.map((p) => onPhoto(c, p)));

function expectNear(actual: readonly Point2[], expected: readonly Point2[], digits = 9): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i].x, digits);
    expect(p.y).toBeCloseTo(expected[i].y, digits);
  });
}

describe("hand-trace editor: a cleanup change carries the points", () => {
  const triangle = () => corners(1, [0.2, 0.2], [0.8, 0.2], [0.5, 0.6]);

  it("a crop keeps each point on its spot of the photo, on the cropped photo's page", () => {
    const editor = overPhoto(WHOLE, triangle());
    const before = spots(editor, WHOLE);
    const cropped = crop(40, 30, 360, 270);
    editor.changeCleanup(cropped, false);
    expectNear(spots(editor, cropped), before);
    expect(editor.page()).toEqual(photoPage(cleaned(cropped)));
    expect(editor.cleanup()).toBe(cropped);
  });

  it("is one undo step: undo puts the points, the page and the cleanup back; redo the change", () => {
    const editor = overPhoto(WHOLE, triangle());
    const shapes = editor.shapes();
    const cropped = crop(40, 30, 360, 270);
    editor.changeCleanup(cropped, false);
    const carried = editor.shapes();
    editor.undo();
    expect(editor.shapes()).toEqual(shapes);
    expect(editor.page()).toEqual(photoPage(cleaned(WHOLE)));
    expect(editor.cleanup()).toBe(WHOLE);
    editor.redo();
    expect(editor.shapes()).toEqual(carried);
    expect(editor.cleanup()).toBe(cropped);
  });

  it("can be undone and redone while the canvas isn't shown, as from Cleanup or with auto-trace chosen", () => {
    const editor = overPhoto(WHOLE, triangle());
    editor.resize(0, 0); // the canvas is hidden
    const cropped = crop(40, 30, 360, 270);
    editor.changeCleanup(cropped, false);
    expect(editor.drawn().can).toMatchObject({ undo: true, redo: false });

    editor.undo();
    expect(editor.cleanup()).toBe(WHOLE);
    expect(editor.drawn().can).toMatchObject({ undo: false, redo: true });
    editor.redo();
    expect(editor.cleanup()).toBe(cropped);
  });
});

/** Each point's handle tips, `in` then `out` (where it has them), as design-space positions. */
const tips = (shape: Shape): Point2[] =>
  shape.points.flatMap((p) => [p.in, p.out].flatMap((h) => (h ? [{ x: p.x + h.x, y: p.y + h.y }] : [])));

/** A curved shape: a smooth point with both handles stored, a corner with one, a smooth one with automatic handles. */
function curved(id = 1): Shape {
  return {
    id,
    closed: true,
    mirror: "none",
    points: [
      { x: 0.3, y: 0.2, kind: "smooth", in: { x: -0.1, y: 0.05 }, out: { x: 0.15, y: -0.075 } },
      { x: 0.7, y: 0.25, kind: "corner", out: { x: 0.02, y: 0.1 } },
      { x: 0.5, y: 0.55, kind: "smooth" },
    ],
  };
}

describe("hand-trace editor: crop, rotate, Turn and aspect changes carry points and handles exactly", () => {
  const framed = crop(40, 30, 360, 270);
  it.each<[string, Cleanup]>([
    ["a crop", crop(100, 50, 300, 250)],
    ["Rotate 90°", { ...framed, corners: rotateFrame(framed.corners) }],
    ["Turn", { ...framed, corners: turnFrame(framed.corners, 10, PHOTO).corners }],
    ["an aspect change", { ...framed, aspect: "square" }],
  ])("%s keeps every point and stored handle tip on its spot of the photo", (_, to) => {
    const editor = overPhoto(framed, curved());
    const [before] = editor.shapes();
    editor.changeCleanup(to, false);
    const [after] = editor.shapes();
    expectNear(spots(editor, to), before.points.map((p) => onPhoto(framed, p)));
    expectNear(tips(after).map((p) => onPhoto(to, p)), tips(before).map((p) => onPhoto(framed, p)));
    // Automatic handles stay automatic.
    expect(after.points[2]).not.toHaveProperty("in");
    expect(after.points[2]).not.toHaveProperty("out");
  });
});

describe("hand-trace editor: a four-corner change", () => {
  const framed = crop(40, 30, 360, 270);
  /** The frame dragged onto a sheet seen at an angle. */
  const tilted: Cleanup = { corners: frameAt([60, 40], [350, 20], [380, 280], [30, 250]), aspect: null };

  it("keeps a straight-edged shape exact: its Design is the same outline on the photo", () => {
    const editor = overPhoto(framed, corners(1, [0.2, 0.2], [0.8, 0.2], [0.8, 0.6], [0.3, 0.5]));
    const before = editor.shapes()[0].points.map((p) => onPhoto(framed, p));
    editor.changeCleanup(tilted, false);
    const after = editor.design()!.paths.map((path) => path.map((p) => onPhoto(tilted, p)));
    // Within a thousandth of a photo px: path data keeps six significant digits.
    expectSameOutlines(after, [before], 1e-3);
  });

  it("puts point and handle tips where the homography sends them, and a smooth point stays smooth", () => {
    const editor = overPhoto(framed, curved());
    const [before] = editor.shapes();
    editor.changeCleanup(tilted, false);
    const [after] = editor.shapes();
    expectNear(spots(editor, tilted), before.points.map((p) => onPhoto(framed, p)));
    // The corner's handle tip, which no averaging touches.
    const [corner, cornerWas] = [after.points[1], before.points[1]];
    const tip = (p: Point) => onPhoto(tilted, { x: p.x + p.out!.x, y: p.y + p.out!.y });
    const tipWas = onPhoto(framed, { x: cornerWas.x + cornerWas.out!.x, y: cornerWas.y + cornerWas.out!.y });
    expectNear([tip(corner)], [tipWas]);
    // The smooth point's handles: on one line, pointing opposite ways.
    const { in: hin, out: hout } = after.points[0];
    expect(hin!.x * hout!.y - hin!.y * hout!.x).toBeCloseTo(0, 12);
    expect(hin!.x * hout!.x + hin!.y * hout!.y).toBeLessThan(0);
    expect(after.points[0].kind).toBe("smooth");
  });
});

describe("hand-trace editor: live while a frame corner is dragged", () => {
  const framed = crop(40, 30, 360, 270);
  /** The frame's top-left corner dragged in, a step at a time. */
  const dragged = [50, 70, 90].map((x): Cleanup => ({ ...framed, corners: frameAt([x, x], [360, 30], [360, 270], [40, 270]) }));
  const square = () => corners(1, [0.2, 0.2], [0.8, 0.2], [0.8, 0.6], [0.2, 0.6]);
  /** Every point as drawn, as a fraction of the drawn page: where it is on the page. */
  const drawnOnPage = (editor: HandTrace<Cleanup>) => {
    const { page, points } = editor.drawn();
    return points.map(({ at }) => ({ x: (at.x - page.x) / page.width, y: (at.y - page.y) / page.height }));
  };

  it("shows the shapes carried as the frame moves, keeping the Design and the record as they were", () => {
    const released = overPhoto(framed, square());
    released.changeCleanup(dragged[2], false);
    const editor = overPhoto(framed, square());
    const [design, record] = [editor.design(), editor.record()];
    for (const c of dragged) editor.changeCleanup(c, true);
    expectNear(drawnOnPage(editor), drawnOnPage(released));
    expect(editor.design()).toBe(design);
    expect(editor.record()).toBe(record);
  });

  it("each released change is one undo step, carried from where the drag started", () => {
    const editor = overPhoto(framed, square());
    const before = editor.shapes();
    for (const c of dragged) editor.changeCleanup(c, true);
    editor.changeCleanup(dragged[2], false);
    const direct = overPhoto(framed, square());
    direct.changeCleanup(dragged[2], false);
    expect(editor.shapes()).toEqual(direct.shapes());
    expect(editor.design()).not.toBeNull();
    editor.undo();
    expect(editor.shapes()).toEqual(before);
    expect(editor.cleanup()).toBe(framed);
    expect(editor.drawn().can.undo).toBe(false);
  });

  it("a release with the cleanup it's already on (a frame corner clicked, not moved) is no undo step", () => {
    const editor = overPhoto(framed, square());
    const record = editor.record();
    editor.changeCleanup(framed, false);
    expect(editor.drawn().can.undo).toBe(false);
    expect(editor.record()).toBe(record);
  });
});

describe("hand-trace editor: mirrored shapes through a cleanup change", () => {
  /** A twin eye left of the axis, as its points are stored. */
  const eye = (): Shape => ({ ...corners(1, [0.2, 0.3], [0.4, 0.3], [0.3, 0.5]), mirror: "twin" });
  /** The photo's right part cropped off: the frame is off-centre, so the axis lands elsewhere on the photo. */
  const offCentre = crop(0, 0, 320, 300);
  /** Each point as drawn, in design space under cleanup `c`. */
  const drawnPoints = (editor: HandTrace<Cleanup>, c: Cleanup) => {
    const { page, points } = editor.drawn();
    const height = photoPage(cleaned(c)).height;
    return points.map(({ at }) => ({ x: (at.x - page.x) / page.width, y: (1 - (at.y - page.y) / page.height) * height }));
  };

  it("an off-centre re-frame shifts the reflections live: the source stays on its spots, mirrored about the new axis", () => {
    const editor = overPhoto(WHOLE, eye());
    const before = spots(editor, WHOLE);
    editor.changeCleanup(offCentre, true);
    expectNear(spots(editor, offCentre), before);
    const drawn = drawnPoints(editor, offCentre);
    const [source, reflection] = [drawn.slice(0, 3), drawn.slice(3)];
    expectNear(reflection, source.map((p) => ({ x: 1 - p.x, y: p.y })), 6);
    // On the photo, the reflection has moved: the axis is now the cropped photo's middle, x = 160 px, not 200.
    const reflected = reflection.map((p) => onPhoto(offCentre, p));
    expect(reflected[0].x).toBeCloseTo(320 - 80, 4);
  });

  it("keeps a mirrored shape's points on its side of the axis: one carried across stops on it", () => {
    const editor = overPhoto(WHOLE, { ...corners(1, [0.2, 0.3], [0.45, 0.3], [0.3, 0.5]), mirror: "twin" });
    // Cropping the right fifth off puts the new axis at photo px 160: the point at 180 px would cross it.
    editor.changeCleanup(offCentre, false);
    const xs = editor.shapes()[0].points.map((p) => p.x);
    expect(xs[1]).toBe(0.5);
    expect(xs[0]).toBeLessThan(0.5);
  });
});

describe("hand-trace editor: the shapes as Cleanup draws them over the photo", () => {
  it("gives every shape and reflection as path data, each position mapped: closed ones apart from open ones", () => {
    const twin: Shape = { ...corners(1, [0.2, 0.3], [0.4, 0.3], [0.3, 0.5]), mirror: "twin" };
    const line: Shape = { ...corners(2, [0.1, 0.1], [0.9, 0.1], [0.9, 0.2]), closed: false };
    const editor = overPhoto(WHOLE, twin, line);
    const drawn = editor.shapePaths((p) => onPhoto(WHOLE, p));
    const px = (...at: [number, number][]) => at.map(([x, y]) => onPhoto(WHOLE, { x, y }));
    const expected = [px([0.2, 0.3], [0.4, 0.3], [0.3, 0.5]), px([0.8, 0.3], [0.6, 0.3], [0.7, 0.5])];
    expectSameOutlines(outlinesOf(drawn.closed), expected, 1e-3);
    // The comparison closes it: the open shape's points are its outline's.
    expectSameOutlines(outlinesOf(drawn.open), [px([0.1, 0.1], [0.9, 0.1], [0.9, 0.2])], 1e-3);
  });
});

describe("hand-trace editor: points the new frame leaves out", () => {
  it("stay where they fall, still drawn, and are clamped onto the page by their next drag", () => {
    const editor = overPhoto(WHOLE, corners(1, [0.1, 0.1], [0.5, 0.1], [0.3, 0.5]));
    // The left quarter of the photo and its bottom quarter are cropped off: the first point is outside.
    const cropped = crop(100, 0, 400, 225);
    editor.changeCleanup(cropped, false);
    const [first] = editor.shapes()[0].points;
    expect(first.x).toBeLessThan(0);
    expect(first.y).toBeLessThan(0);
    const { points, page } = editor.drawn();
    expect(points).toHaveLength(3);
    const from = points[0].at;
    expect(from.x).toBeLessThan(page.x);
    const to = { x: from.x + 5, y: from.y - 5 };
    editor.gesture({ type: "drag", phase: "start", from, at: from, pointerType: "mouse" });
    editor.gesture({ type: "drag", phase: "move", from, at: to, pointerType: "mouse" });
    editor.gesture({ type: "drag", phase: "end", from, at: to, pointerType: "mouse" });
    const [moved] = editor.shapes()[0].points;
    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0);
  });
});
