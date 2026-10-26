/**
 * The hand-trace editor's public interface: the only way in from outside `src/handTrace` (ADR 0001). No DOM, no
 * packages, the core only through its index.
 */
export { createHandTrace, type Drawn, type HandTrace } from "./editor";
export { createGestureRecognizer, type Gesture, type PointerInput } from "./gestures";
