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

  it("right and middle mouse buttons make no tap or drag", () => {
    const g = createGestureRecognizer();
    for (const button of [1, 2]) {
      g.down(at(10, 10, 0, { pointerType: "mouse", button }));
      expect(g.move(at(60, 10, 10, { pointerType: "mouse", button }))).toEqual([]);
      expect(g.up(at(60, 10, 20, { pointerType: "mouse", button }))).toEqual([]);
    }
  });
});
