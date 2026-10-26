/**
 * The hand-trace editor's public interface: the only way in from outside `src/handTrace` (ADR 0001). No DOM, no
 * packages, the core only through its index.
 */
export { ARROWS, NUDGE_PX, SHIFT_NUDGE_PX } from "./dispatch";
export {
  createHandTrace,
  type Drawn,
  type HandTrace,
  type HandTraceCleanup,
  type HandTraceOptions,
  type ShapePaths,
} from "./editor";
export { HIT_RADIUS_PX } from "./hits";
export { placeLoupe, type Loupe } from "./loupe";
export { createGestureRecognizer, HOLD_MS, type Gesture, type PointerInput } from "./gestures";
export type { XY } from "./curves";
export type { HandTraceRecord, Offset, Page, Point, Shape } from "./model";
