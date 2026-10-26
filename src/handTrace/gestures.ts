/**
 * The gesture recognizer: pointer events with timestamps in, gestures out. Thin and pure, so the DOM only forwards
 * `PointerEvent`s and wheel events (ADR 0001). Positions are screen pixels relative to the canvas.
 */

/** A position on screen, in CSS pixels from the canvas's top left. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** What kind of pointer made a gesture, as `PointerEvent.pointerType` says. */
export type PointerKind = "mouse" | "pen" | "touch";

/** One pointer event, as the DOM forwards it. */
export interface PointerInput extends ScreenPoint {
  /** `PointerEvent.pointerId`. */
  id: number;
  /** When it happened, in ms (`PointerEvent.timeStamp`). */
  t: number;
  pointerType: PointerKind;
  /** `PointerEvent.button` on a press: 0 is the main button (or a touch), 1 the middle, 2 the right. */
  button: number;
}

/** One wheel event (mouse wheel, Ctrl + wheel pinch or two-finger scroll), its delta in pixels. */
export interface WheelInput extends ScreenPoint {
  deltaY: number;
}

/** A press and lift without moving: commits on lift, where the press was. */
export interface TapGesture {
  type: "tap";
  at: ScreenPoint;
  pointerType: PointerKind;
}

/**
 * A press that moved: `start` once it has moved past the slop, then `move`s, then `end` on lift or `cancel` when
 * the browser takes the pointer away. `from` is where the press was, `at` where the pointer is now.
 */
export interface DragGesture {
  type: "drag";
  phase: "start" | "move" | "end" | "cancel";
  from: ScreenPoint;
  at: ScreenPoint;
  pointerType: PointerKind;
}

/** A wheel turn at the cursor; positive `deltaY` scrolls down (zooms out). */
export interface WheelGesture {
  type: "wheel";
  at: ScreenPoint;
  deltaY: number;
}

export type Gesture = TapGesture | DragGesture | WheelGesture;

export interface GestureRecognizer {
  down(e: PointerInput): Gesture[];
  move(e: PointerInput): Gesture[];
  up(e: PointerInput): Gesture[];
  /** `pointercancel`: the browser took the pointer (e.g. for a scroll). */
  cancel(e: PointerInput): Gesture[];
  wheel(e: WheelInput): Gesture[];
}

/** How far (screen px) a press may wander and still be a tap rather than a drag. */
const SLOP_PX = 9;

/**
 * Follows one pointer at a time: a press is a tap if it lifts within the slop, else a drag. Only the main
 * button presses; other pointers landing meanwhile are ignored (pinch comes later).
 */
export function createGestureRecognizer(): GestureRecognizer {
  /** The press being followed, and whether it has become a drag. */
  let press: { id: number; from: ScreenPoint; pointerType: PointerKind; dragging: boolean } | null = null;
  const pt = (e: ScreenPoint): ScreenPoint => ({ x: e.x, y: e.y });
  const mine = (e: PointerInput) => press !== null && press.id === e.id;

  return {
    down(e) {
      if (press || e.button !== 0) return [];
      press = { id: e.id, from: pt(e), pointerType: e.pointerType, dragging: false };
      return [];
    },
    move(e) {
      if (!press || !mine(e)) return [];
      const { from, pointerType } = press;
      if (press.dragging) return [{ type: "drag", phase: "move", from, at: pt(e), pointerType }];
      if (Math.hypot(e.x - from.x, e.y - from.y) <= SLOP_PX) return [];
      press.dragging = true;
      return [{ type: "drag", phase: "start", from, at: pt(e), pointerType }];
    },
    up(e) {
      if (!press || !mine(e)) return [];
      const { from, pointerType, dragging } = press;
      press = null;
      return dragging
        ? [{ type: "drag", phase: "end", from, at: pt(e), pointerType }]
        : [{ type: "tap", at: from, pointerType }];
    },
    cancel(e) {
      if (!press || !mine(e)) return [];
      const { from, pointerType, dragging } = press;
      press = null;
      return dragging ? [{ type: "drag", phase: "cancel", from, at: pt(e), pointerType }] : [];
    },
    wheel: (e) => [{ type: "wheel", at: pt(e), deltaY: e.deltaY }],
  };
}
