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
  /** `PointerEvent.altKey`: Alt held (a drag pressed with it says so). */
  alt?: boolean;
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
 * A second tap within `DOUBLE_TAP_MS` of the first and within `DOUBLE_TAP_PX` of where it was, given in place of
 * that tap: the editor takes the first tap back and toggles the point under both (a double-click too). A third tap
 * is a plain tap again.
 */
export interface DoubleTapGesture {
  type: "doubleTap";
  at: ScreenPoint;
  pointerType: PointerKind;
}

/**
 * A press that moved: `start` once it has moved past the slop, then `move`s, then `end` on lift or `cancel` when
 * the browser takes the pointer away. `from` is where the press was, `at` where the pointer is now. `alt` when Alt
 * was held at the press (left out otherwise).
 */
export interface DragGesture {
  type: "drag";
  phase: "start" | "move" | "end" | "cancel";
  from: ScreenPoint;
  at: ScreenPoint;
  pointerType: PointerKind;
  alt?: boolean;
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

/**
 * A press that pans from anywhere, whatever is under it: a middle-button drag, or a drag pressed while Space is held.
 * Phases as a drag's; a press that never moves past the slop makes no gesture at all (and no tap).
 */
export interface PanGesture {
  type: "pan";
  phase: "start" | "move" | "end" | "cancel";
  from: ScreenPoint;
  at: ScreenPoint;
  pointerType: PointerKind;
}

/**
 * A mouse or pen over the canvas with nothing pressed, at `at` (null once it has left), so the canvas can show what
 * a click would hit. `pans` while Space is held, as a press then would pan. A touch never hovers.
 */
export interface HoverGesture {
  type: "hover";
  at: ScreenPoint | null;
  pointerType: PointerKind;
  pans: boolean;
}

/** A wheel turn at the cursor; positive `deltaY` scrolls down (zooms out). */
export interface WheelGesture {
  type: "wheel";
  at: ScreenPoint;
  deltaY: number;
}

export type Gesture =
  | TapGesture
  | DoubleTapGesture
  | DragGesture
  | HoldGesture
  | PanGesture
  | PinchGesture
  | MultiTapGesture
  | WheelGesture
  | HoverGesture;

export interface GestureRecognizer {
  down(e: PointerInput): Gesture[];
  move(e: PointerInput): Gesture[];
  up(e: PointerInput): Gesture[];
  /** `pointercancel`: the browser took the pointer (e.g. for a scroll). */
  cancel(e: PointerInput): Gesture[];
  wheel(e: WheelInput): Gesture[];
  /** Space went down (`held`) or up while the canvas has focus: a press while it's held pans. */
  space(held: boolean): Gesture[];
  /** The pointer left the canvas (`pointerleave`): nothing hovers now. */
  leave(): Gesture[];
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
 * How soon (ms, lift to lift) and how near (screen px, the hit radius) a second tap must follow the first to be a
 * double-tap.
 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 22;

/**
 * Follows one press at a time: it's a tap if it lifts within the slop, else a drag; a touch press held still becomes
 * a hold. A second pointer landing cancels the press and starts a multi-finger gesture (a pinch, or a two- or
 * three-finger tap) that lasts until every finger has lifted. The main button presses; the middle button, or the
 * main one while Space is held, presses to pan. A mouse or pen with nothing pressed hovers.
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
    /** It pans from anywhere: a middle-button press, or one made while Space was held. */
    pans: boolean;
    alt: boolean;
  } | null = null;
  /** The last gesture was a tap (not itself the second of a double-tap): when it lifted and where it was. */
  let lastTap: { t: number; at: ScreenPoint } | null = null;
  /** Space is held down. */
  let spaceHeld = false;
  /** Where the mouse or pen hovers, while nothing is pressed. */
  let hover: { at: ScreenPoint; pointerType: PointerKind } | null = null;
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
  const of = (as: "drag" | "hold", phase: DragGesture["phase"], at: ScreenPoint): Gesture => {
    const { from, pointerType, pans, alt } = press!;
    if (pans) return { type: "pan", phase, from, at, pointerType };
    return { type: as, phase, from, at, pointerType, ...(alt && as === "drag" && { alt }) };
  };
  /** A press lifted in place at `t`: a tap, or the second of a double-tap. */
  const tapped = (from: ScreenPoint, pointerType: PointerKind, t: number): Gesture => {
    const near = lastTap && Math.hypot(from.x - lastTap.at.x, from.y - lastTap.at.y) < DOUBLE_TAP_PX;
    const second = near && t - lastTap!.t < DOUBLE_TAP_MS;
    lastTap = second ? null : { t, at: from };
    return { type: second ? "doubleTap" : "tap", at: from, pointerType };
  };
  const hovering = (): Gesture[] => (hover ? [{ type: "hover", ...hover, pans: spaceHeld }] : []);
  /** A touch press still at `t` past `HOLD_MS` becomes a hold where it was last seen, however late the timer. */
  const holdBy = (t: number): Gesture[] => {
    if (!press || press.as !== "press" || press.pans || press.pointerType !== "touch" || t - press.t < HOLD_MS) return [];
    press.as = "hold";
    lastTap = null;
    return [of("hold", "start", press.at)];
  };

  return {
    down(e) {
      if ((e.button !== 0 && e.button !== 1) || mine(e)) return [];
      hover = null;
      const out = press ? secondFinger() : [];
      if (multi) {
        lastTap = null;
        multi.fingers.set(e.id, { from: pt(e), at: pt(e) });
        multi.most = Math.max(multi.most, multi.fingers.size);
        multi.pair = pairOf(multi.fingers);
      } else {
        const pans = e.button === 1 || spaceHeld;
        const alt = e.alt ?? false;
        press = { id: e.id, t: e.t, from: pt(e), at: pt(e), pointerType: e.pointerType, as: "press", pans, alt };
      }
      return out;
    },
    move(e) {
      if (multi) return pinch(e);
      if (!press && e.pointerType !== "touch") {
        hover = { at: pt(e), pointerType: e.pointerType };
        return hovering();
      }
      if (!press || !mine(e)) return [];
      const out = holdBy(e.t);
      press.at = pt(e);
      if (press.as === "press") {
        if (Math.hypot(e.x - press.from.x, e.y - press.from.y) <= SLOP_PX) return out;
        press.as = "drag";
        lastTap = null;
        return [...out, of("drag", "start", pt(e))];
      }
      return [...out, of(press.as, "move", pt(e))];
    },
    up(e) {
      if (multi) return lift(e, true);
      if (!press || !mine(e)) return [];
      const out = holdBy(e.t);
      const { from, pointerType, as, pans } = press;
      // It hovers again from the next move; the editor knows where a drag ended.
      const ended = as !== "press" ? [of(as, "end", pt(e))] : pans ? [] : [tapped(from, pointerType, e.t)];
      press = null;
      return [...out, ...ended];
    },
    cancel(e) {
      if (multi) return lift(e, false);
      if (!press || !mine(e)) return [];
      const ended = press.as === "press" ? [] : [of(press.as, "cancel", pt(e))];
      press = null;
      return ended;
    },
    wheel: (e) => [{ type: "wheel", at: pt(e), deltaY: e.deltaY }],
    space(held) {
      if (held === spaceHeld) return [];
      spaceHeld = held;
      return hovering();
    },
    leave() {
      if (!hover) return [];
      const { pointerType } = hover;
      hover = null;
      return [{ type: "hover", at: null, pointerType, pans: spaceHeld }];
    },
    tick: holdBy,
  };
}
