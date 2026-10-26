/**
 * The hand-trace editor's public interface: the only way in from outside `src/handTrace` (ADR 0001). No DOM, no
 * packages, the core only through its index.
 */
export {
  createHandTrace,
  type Drawn,
  type HandTrace,
  type HandTraceCleanup,
  type HandTraceOptions,
  type Loupe,
  placeLoupe,
} from "./editor";
export { createGestureRecognizer, HOLD_MS, type Gesture, type PointerInput } from "./gestures";
export type { HandTraceRecord, Offset, Page, Point, Shape } from "./model";
