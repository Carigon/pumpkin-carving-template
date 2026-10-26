import { describe, expect, it } from "vitest";
import { createGestureRecognizer, type PointerInput } from "../src/handTrace";

/** A pointer event: a touch by default, pointer 1, at time `t` ms. */
const at = (x: number, y: number, t = 0, extra: Partial<PointerInput> = {}): PointerInput => ({
  id: 1,
  x,
  y,
  t,
  pointerType: "touch",
  button: 0,
  ...extra,
});

describe("gesture recognizer", () => {
  it("a press and lift in place is a tap where it was pressed", () => {
    const g = createGestureRecognizer();
    expect(g.down(at(10, 20))).toEqual([]);
    expect(g.up(at(11, 21, 80))).toEqual([{ type: "tap", at: { x: 10, y: 20 }, pointerType: "touch" }]);
  });

  it("a mouse press held still before lifting is still a tap", () => {
    const g = createGestureRecognizer();
    g.down(at(10, 20, 0, { pointerType: "mouse" }));
    expect(g.up(at(10, 20, 2000, { pointerType: "mouse" }))).toEqual([
      { type: "tap", at: { x: 10, y: 20 }, pointerType: "mouse" },
    ]);
  });

  it("a press that moves past the slop is a drag: start, moves, then end on lift, and no tap", () => {
    const g = createGestureRecognizer();
    g.down(at(100, 100));
    expect(g.move(at(104, 100, 10))).toEqual([]);
    const from = { x: 100, y: 100 };
    expect(g.move(at(130, 90, 20))).toEqual([
      { type: "drag", phase: "start", from, at: { x: 130, y: 90 }, pointerType: "touch" },
    ]);
    expect(g.move(at(150, 80, 30))).toEqual([
      { type: "drag", phase: "move", from, at: { x: 150, y: 80 }, pointerType: "touch" },
    ]);
    expect(g.up(at(150, 80, 40))).toEqual([
      { type: "drag", phase: "end", from, at: { x: 150, y: 80 }, pointerType: "touch" },
    ]);
  });

  it("a press that wanders out and back is still a drag, not a tap", () => {
    const g = createGestureRecognizer();
    g.down(at(100, 100));
    g.move(at(140, 100, 10));
    expect(g.up(at(100, 100, 20))).toMatchObject([{ type: "drag", phase: "end" }]);
  });

  it("a cancelled drag ends as a cancel, and a cancelled press gives nothing", () => {
    const g = createGestureRecognizer();
    g.down(at(0, 0));
    g.move(at(50, 0, 10));
    expect(g.cancel(at(50, 0, 20))).toMatchObject([{ type: "drag", phase: "cancel" }]);
    g.down(at(0, 0, 30));
    expect(g.cancel(at(0, 0, 40))).toEqual([]);
    expect(g.up(at(0, 0, 50))).toEqual([]);
  });

  it("a wheel turn is a wheel gesture at the cursor", () => {
    const g = createGestureRecognizer();
    expect(g.wheel({ x: 30, y: 40, deltaY: -100 })).toEqual([{ type: "wheel", at: { x: 30, y: 40 }, deltaY: -100 }]);
  });

  describe("hold", () => {
    it("a touch press held still for 300 ms becomes a hold, which follows every move after it and ends on lift", () => {
      const g = createGestureRecognizer();
      g.down(at(100, 100, 1000));
      expect(g.tick(1299)).toEqual([]);
      const from = { x: 100, y: 100 };
      expect(g.tick(1300)).toEqual([{ type: "hold", phase: "start", from, at: from, pointerType: "touch" }]);
      expect(g.tick(1400)).toEqual([]);
      // Inside the slop too: the finger is aiming now.
      expect(g.move(at(103, 101, 1450))).toEqual([
        { type: "hold", phase: "move", from, at: { x: 103, y: 101 }, pointerType: "touch" },
      ]);
      expect(g.up(at(104, 101, 1500))).toEqual([
        { type: "hold", phase: "end", from, at: { x: 104, y: 101 }, pointerType: "touch" },
      ]);
    });

    it("a lift before 300 ms is a tap, and a move past the slop before then is a drag that never holds", () => {
      const g = createGestureRecognizer();
      g.down(at(10, 10, 0));
      expect(g.up(at(10, 10, 299))).toMatchObject([{ type: "tap" }]);
      g.down(at(10, 10, 1000));
      expect(g.move(at(40, 10, 1100))).toMatchObject([{ type: "drag", phase: "start" }]);
      expect(g.tick(1400)).toEqual([]);
      expect(g.move(at(50, 10, 1500))).toMatchObject([{ type: "drag", phase: "move" }]);
    });

    it("a hold is still a hold when its timer runs late: the next event says so first", () => {
      const g = createGestureRecognizer();
      g.down(at(10, 10, 0));
      expect(g.up(at(11, 10, 450))).toEqual([
        { type: "hold", phase: "start", from: { x: 10, y: 10 }, at: { x: 10, y: 10 }, pointerType: "touch" },
        { type: "hold", phase: "end", from: { x: 10, y: 10 }, at: { x: 11, y: 10 }, pointerType: "touch" },
      ]);
    });

    it("a mouse or pen press held still is no hold: it lifts as a tap", () => {
      for (const pointerType of ["mouse", "pen"] as const) {
        const g = createGestureRecognizer();
        g.down(at(10, 20, 0, { pointerType }));
        expect(g.tick(2000)).toEqual([]);
        expect(g.up(at(10, 20, 2000, { pointerType }))).toEqual([{ type: "tap", at: { x: 10, y: 20 }, pointerType }]);
      }
    });

    it("a cancelled hold ends as a cancel", () => {
      const g = createGestureRecognizer();
      g.down(at(10, 10, 0));
      g.tick(300);
      expect(g.cancel(at(10, 10, 400))).toMatchObject([{ type: "hold", phase: "cancel" }]);
    });
  });

  describe("more than one finger", () => {
    /** Pointer `id`'s event. */
    const finger = (id: number, x: number, y: number, t: number) => at(x, y, t, { id });

    it("a second finger landing cancels the first finger's drag; that finger's later moves drag nothing", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.move(finger(1, 140, 100, 50));
      expect(g.down(finger(2, 200, 100, 80))).toEqual([
        { type: "drag", phase: "cancel", from: { x: 100, y: 100 }, at: { x: 140, y: 100 }, pointerType: "touch" },
      ]);
      expect(g.up(finger(2, 200, 100, 600))).toEqual([]);
      expect(g.move(finger(1, 160, 100, 650))).toEqual([]);
      expect(g.up(finger(1, 160, 100, 700))).toEqual([]);
    });

    it("a second finger landing cancels a hold, and a press that was neither drag nor hold just gives no tap", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.tick(300);
      expect(g.down(finger(2, 200, 100, 400))).toMatchObject([{ type: "hold", phase: "cancel" }]);
      g.up(finger(1, 100, 100, 900));
      g.up(finger(2, 200, 100, 900));
      g.down(finger(1, 100, 100, 1000));
      expect(g.down(finger(2, 200, 100, 1050))).toEqual([]);
      expect(g.tick(1400)).toEqual([]);
      expect(g.up(finger(1, 100, 100, 1100))).toEqual([]);
    });

    it("two fingers lifting within 350 ms of the first landing, without moving, are a two-finger tap", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.down(finger(2, 200, 100, 40));
      g.move(finger(2, 204, 102, 100));
      expect(g.up(finger(1, 100, 100, 200))).toEqual([]);
      expect(g.up(finger(2, 204, 102, 340))).toEqual([{ type: "multiTap", fingers: 2, pointerType: "touch" }]);
    });

    it("three fingers are a three-finger tap", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.down(finger(2, 200, 100, 20));
      g.down(finger(3, 300, 100, 40));
      g.up(finger(1, 100, 100, 150));
      g.up(finger(2, 200, 100, 160));
      expect(g.up(finger(3, 300, 100, 170))).toEqual([{ type: "multiTap", fingers: 3, pointerType: "touch" }]);
    });

    it("is timed from the first finger: a second finger landing late leaves too little time for a tap", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.down(finger(2, 200, 100, 250));
      expect(g.up(finger(1, 100, 100, 330))).toEqual([]);
      expect(g.up(finger(2, 200, 100, 360))).toEqual([]);
    });

    it("isn't a tap when the first finger was already dragging, nor when a finger moved", () => {
      const dragging = createGestureRecognizer();
      dragging.down(finger(1, 100, 100, 0));
      dragging.move(finger(1, 130, 100, 30));
      dragging.down(finger(2, 200, 100, 60));
      dragging.up(finger(1, 130, 100, 100));
      expect(dragging.up(finger(2, 200, 100, 120))).toEqual([]);
      const moved = createGestureRecognizer();
      moved.down(finger(1, 100, 100, 0));
      moved.down(finger(2, 200, 100, 20));
      moved.move(finger(2, 240, 100, 60));
      moved.up(finger(1, 100, 100, 100));
      expect(moved.up(finger(2, 240, 100, 120))).toEqual([]);
    });

    it("two fingers moving are a pinch: each move gives the change in their middle and in their spread", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.down(finger(2, 200, 100, 10));
      // Within the slop it isn't a pinch yet, so a two-finger tap doesn't nudge the view...
      expect(g.move(finger(2, 205, 100, 20))).toEqual([]);
      // ...and once it is, the first pinch includes that bit.
      expect(g.move(finger(2, 300, 100, 30))).toEqual([
        { type: "pinch", from: { x: 150, y: 100 }, at: { x: 200, y: 100 }, scale: 2, pointerType: "touch" },
      ]);
      // Now 200 across and 100 down apart, from 200 across.
      const scale = Math.hypot(200, 100) / 200;
      expect(g.move(finger(1, 100, 200, 40))).toEqual([
        { type: "pinch", from: { x: 200, y: 100 }, at: { x: 200, y: 150 }, scale, pointerType: "touch" },
      ]);
    });

    it("a finger lifting mid-pinch leaves the other moving nothing; a new pair carries on from where they are", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.down(finger(2, 200, 100, 10));
      g.move(finger(2, 300, 100, 20));
      g.up(finger(2, 300, 100, 30));
      expect(g.move(finger(1, 50, 100, 40))).toEqual([]);
      g.down(finger(3, 150, 100, 50));
      expect(g.move(finger(3, 250, 100, 60))).toEqual([
        { type: "pinch", from: { x: 100, y: 100 }, at: { x: 150, y: 100 }, scale: 2, pointerType: "touch" },
      ]);
    });

    it("a cancelled finger ends the gesture without a tap once every finger is gone", () => {
      const g = createGestureRecognizer();
      g.down(finger(1, 100, 100, 0));
      g.down(finger(2, 200, 100, 20));
      expect(g.cancel(finger(1, 100, 100, 50))).toEqual([]);
      expect(g.cancel(finger(2, 200, 100, 60))).toEqual([]);
      g.down(finger(1, 100, 100, 100));
      expect(g.up(finger(1, 100, 100, 150))).toMatchObject([{ type: "tap" }]);
    });
  });

  it("right and middle mouse buttons make no tap or drag", () => {
    const g = createGestureRecognizer();
    for (const button of [1, 2]) {
      g.down(at(10, 10, 0, { pointerType: "mouse", button }));
      expect(g.move(at(60, 10, 10, { pointerType: "mouse", button }))).toEqual([]);
      expect(g.up(at(60, 10, 20, { pointerType: "mouse", button }))).toEqual([]);
    }
  });
});
