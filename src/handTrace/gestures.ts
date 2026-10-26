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

/**
 * A touch press held still for `HOLD_MS`: `start` then, with no slop now (the finger is aiming), a `move` for every
 * move, and `end` on lift or `cancel`. A mouse or pen press held still is still a click, so only touch holds.
 */
export interface HoldGesture {
  type: "hold";
  phase: "start" | "move" | "end" | "cancel";
  from: ScreenPoint;
  at: ScreenPoint;
  pointerType: PointerKind;
}

/**
 * Two fingers moving apart, together or across: since the last pinch their middle went from `from` to `at` and the
 * distance between them grew `scale` times. Zooms and pans.
 */
export interface PinchGesture {
  type: "pinch";
  from: ScreenPoint;
  at: ScreenPoint;
  scale: number;
  pointerType: PointerKind;
}

/**
 * Two or three fingers that landed and all lifted without moving, within `MULTI_TAP_MS` of the first finger
 * landing (a first finger already dragging or holding makes no tap). Undoes, or redoes.
 */
export interface MultiTapGesture {
  type: "multiTap";
  fingers: 2 | 3;
  pointerType: PointerKind;
}

/** A wheel turn at the cursor; positive `deltaY` scrolls down (zooms out). */
export interface WheelGesture {
  type: "wheel";
  at: ScreenPoint;
  deltaY: number;
}

export type Gesture = TapGesture | DragGesture | HoldGesture | PinchGesture | MultiTapGesture | WheelGesture;

export interface GestureRecognizer {
  down(e: PointerInput): Gesture[];
  move(e: PointerInput): Gesture[];
  up(e: PointerInput): Gesture[];
  /** `pointercancel`: the browser took the pointer (e.g. for a scroll). */
  cancel(e: PointerInput): Gesture[];
  wheel(e: WheelInput): Gesture[];
  /**
   * Time has passed: it's `t` ms now, on the clock `PointerInput.t` uses. The recognizer keeps no timers, so the
   * canvas calls this `HOLD_MS` after a press.
   */
  tick(t: number): Gesture[];
}

/** Two fingers' middle and the distance between them (px). */
interface Pair {
  middle: ScreenPoint;
  spread: number;
}

/** How far (screen px) a press may wander and still be a tap rather than a drag. */
const SLOP_PX = 9;
/** How long (ms) a touch press stays still before it's a hold. */
export const HOLD_MS = 300;
/** How soon (ms) after the first finger lands every finger must lift for a two- or three-finger tap. */
const MULTI_TAP_MS = 350;

/**
 * Follows one press at a time: it's a tap if it lifts within the slop, else a drag; a touch press held still becomes
 * a hold. A second pointer landing cancels the press and starts a multi-finger gesture (a pinch, or a two- or
 * three-finger tap) that lasts until every finger has lifted. Only the main button presses.
 */
export function createGestureRecognizer(): GestureRecognizer {
  /** The one press being followed: when and where it started, where it is now, and what it has become. */
  let press: {
    id: number;
    t: number;
    from: ScreenPoint;
    at: ScreenPoint;
    pointerType: PointerKind;
    as: "press" | "drag" | "hold";
  } | null = null;
  /**
   * The multi-finger gesture under way: when its first finger landed, the most fingers down at once, whether it can
   * no longer be a tap, each finger's landing and current position, and the pinch's last middle and spread.
   */
  let multi: {
    t: number;
    most: number;
    moved: boolean;
    pointerType: PointerKind;
    fingers: Map<number, { from: ScreenPoint; at: ScreenPoint }>;
    pair: Pair | null;
  } | null = null;

  /** The middle of the first two fingers down and the distance between them, if two are down. */
  const pairOf = (fingers: Map<number, { at: ScreenPoint }>): Pair | null => {
    const [a, b] = [...fingers.values()].map((f) => f.at);
    if (!b) return null;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { middle, spread: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) };
  };
  /** A second finger lands: the press is cancelled (as a drag or hold, or quietly) and becomes a multi-finger one. */
  const secondFinger = (): Gesture[] => {
    const first = press!;
    const out = first.as === "press" ? [] : [of(first.as, "cancel", first.at)];
    const fingers = new Map([[first.id, { from: first.from, at: first.at }]]);
    multi = { t: first.t, most: 1, moved: first.as !== "press", pointerType: first.pointerType, fingers, pair: null };
    press = null;
    return out;
  };
  /** A finger lifts (or is cancelled, `tap` false); the gesture ends with the last, as a tap if it's soon enough. */
  const lift = (e: PointerInput, tap: boolean): Gesture[] => {
    const m = multi!;
    if (!m.fingers.delete(e.id)) return [];
    m.pair = pairOf(m.fingers);
    if (m.fingers.size > 0) return [];
    multi = null;
    if (!tap || m.moved || e.t - m.t >= MULTI_TAP_MS) return [];
    return [{ type: "multiTap", fingers: m.most >= 3 ? 3 : 2, pointerType: m.pointerType }];
  };
  /** A finger of the multi-finger gesture moves: a pinch once any finger has moved past the slop. */
  const pinch = (e: PointerInput): Gesture[] => {
    const m = multi!;
    const finger = m.fingers.get(e.id);
    if (!finger) return [];
    finger.at = pt(e);
    if (Math.hypot(e.x - finger.from.x, e.y - finger.from.y) > SLOP_PX) m.moved = true;
    const [was, now] = [m.pair, pairOf(m.fingers)];
    if (!m.moved || !was || !now) return [];
    m.pair = now;
    const scale = now.spread / was.spread;
    return [{ type: "pinch", from: was.middle, at: now.middle, scale, pointerType: m.pointerType }];
  };

  const pt = (e: ScreenPoint): ScreenPoint => ({ x: e.x, y: e.y });
  const mine = (e: PointerInput) => press !== null && press.id === e.id;
  const of = (type: "drag" | "hold", phase: DragGesture["phase"], at: ScreenPoint): Gesture => {
    const { from, pointerType } = press!;
    return { type, phase, from, at, pointerType };
  };
  /** A touch press still at `t` past `HOLD_MS` becomes a hold where it was last seen, however late the timer. */
  const holdBy = (t: number): Gesture[] => {
    if (!press || press.as !== "press" || press.pointerType !== "touch" || t - press.t < HOLD_MS) return [];
    press.as = "hold";
    return [of("hold", "start", press.at)];
  };

  return {
    down(e) {
      if (e.button !== 0 || mine(e)) return [];
      const out = press ? secondFinger() : [];
      if (multi) {
        multi.fingers.set(e.id, { from: pt(e), at: pt(e) });
        multi.most = Math.max(multi.most, multi.fingers.size);
        multi.pair = pairOf(multi.fingers);
      } else press = { id: e.id, t: e.t, from: pt(e), at: pt(e), pointerType: e.pointerType, as: "press" };
      return out;
    },
    move(e) {
      if (multi) return pinch(e);
      if (!press || !mine(e)) return [];
      const out = holdBy(e.t);
      press.at = pt(e);
      if (press.as === "press") {
        if (Math.hypot(e.x - press.from.x, e.y - press.from.y) <= SLOP_PX) return out;
        press.as = "drag";
        return [...out, of("drag", "start", pt(e))];
      }
      return [...out, of(press.as, "move", pt(e))];
    },
    up(e) {
      if (multi) return lift(e, true);
      if (!press || !mine(e)) return [];
      const out = holdBy(e.t);
      const { from, pointerType, as } = press;
      const ended: Gesture = as === "press" ? { type: "tap", at: from, pointerType } : of(as, "end", pt(e));
      press = null;
      return [...out, ended];
    },
    cancel(e) {
      if (multi) return lift(e, false);
      if (!press || !mine(e)) return [];
      const ended = press.as === "press" ? [] : [of(press.as, "cancel", pt(e))];
      press = null;
      return ended;
    },
    wheel: (e) => [{ type: "wheel", at: pt(e), deltaY: e.deltaY }],
    tick: holdBy,
  };
}
