import { copy, type Drag, type Editor, type Selection, type State } from "./context";
import type { Edits } from "./edits";
import type { KeyInput } from "./editor";
import type { DragGesture, Gesture, HoldGesture, PanGesture, PointerKind, ScreenPoint } from "./gestures";
import type { History, Steps } from "./history";
import type { Hits } from "./hits";
import type { Shape } from "./model";
import { onAxis } from "./symmetry";
import { fitScale, fitView, pinchZoom, toDesignSpace, toScreen, wheelZoom, type ViewTransform } from "./view";

/** How much + and − zoom, as the Blueprint view's zoom buttons do. */
const KEY_ZOOM_STEP = 1.25;
/** How far an arrow key nudges, in screen px, and with Shift (Cleanup's frame corners too). */
export const NUDGE_PX = 1;
export const SHIFT_NUDGE_PX = 10;
/** Each arrow key's direction on screen (y down). */
export const ARROWS: ReadonlyMap<string, { x: number; y: number }> = new Map([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
]);

/** Everything a tap may change, kept so a double-tap can take the tap back. */
interface Before extends Steps {
  state: State;
  selection: Selection | null;
  nextId: number;
}

/**
 * Gestures and keys turned into commands on `ed`: what a tap, double-tap, drag, hold, pan, pinch, wheel turn,
 * multi-finger tap or key press does, by what's under it.
 */
export function createDispatch(ed: Editor, history: History, hits: Hits, edits: Edits) {
  const { change, endReframing, undo, redo } = history;
  const { hitTest, pointOrHandleAt, pointAt, handleAt, tapAction } = hits;
  const { placeAt, place, close, end, openEnd, carryOn, remove, insert, toggleSymmetry, toggled, toggleSelected } = edits;
  const { withKnob, movedBy, nudge, removeLast } = edits;
  /**
   * The last tap: where it was, what was there before it, the point it hit, and the shapes and selection it left.
   * While those are still current, a double-tap there can take it back.
   */
  let tapped: {
    at: ScreenPoint;
    before: Before;
    point: { shape: number; index: number } | null;
    state: State;
    selection: Selection | null;
  } | null = null;

  const tap = (at: ScreenPoint) => {
    const action = tapAction(at);
    if (action.do === "place") place(at);
    else if (action.do === "close") close();
    else if (action.do === "end") end();
    else if (action.do === "select") {
      end();
      ed.selection = action.selection;
    } else if (action.do === "insert") {
      const { shape, index, reflected } = insert(action.hit.marker);
      change({ ...ed.state, shapes: ed.replace(shape) });
      ed.selection = { kind: "point", shape: shape.id, index, ...copy(reflected) };
    } else if (action.do === "deselect") ed.selection = null;
  };

  /** A tap, kept so that a double-tap straight after it can take it back. */
  const firstTap = (at: ScreenPoint) => {
    const before: Before = { state: ed.state, ...history.steps(), selection: ed.selection, nextId: ed.nextId };
    const hit = pointOrHandleAt(at);
    const point = hit?.kind === "point" ? { shape: hit.shape.id, index: hit.index } : null;
    tap(at);
    tapped = { at, before, point, state: ed.state, selection: ed.selection };
  };

  /**
   * The second tap of a double-tap: on the point the first tap hit, take the first tap back and switch the point
   * between smooth and corner instead, selecting it (or carrying on drawing, on the shape being drawn). Anywhere
   * else, or once something has changed since, it's a plain tap.
   */
  const doubleTap = (at: ScreenPoint) => {
    const first = tapped;
    tapped = null;
    if (!first?.point || first.state !== ed.state || first.selection !== ed.selection) return tap(at);
    const { before } = first;
    ed.setState(before.state);
    [ed.selection, ed.nextId] = [before.selection, before.nextId];
    history.restore(before);
    const hit = pointAt(at)?.hit;
    if (hit?.kind !== "point" || hit.shape.id !== first.point.shape || hit.index !== first.point.index) {
      tap(first.at);
      return tap(at);
    }
    if (hit.shape.id !== ed.state.drawing) {
      end();
      ed.selection = { kind: "point", shape: hit.shape.id, index: hit.index, ...copy(hit.reflected) };
    }
    change({ ...ed.state, shapes: ed.replace(toggled(hit.shape, hit.index)) });
  };

  /**
   * What a drag starting at `from` does: move the point under it, add a point at the insert marker under it and
   * move that, move the selected shape, or pan.
   */
  const startDrag = (from: ScreenPoint, pointerType: PointerKind, alone = false): Drag => {
    const hit = hitTest(from);
    const moving = { live: null, selection: ed.selection, at: from, loupe: pointerType === "touch" };
    /** A point starts held on the axis when it's on it, for a mirrored shape. */
    const held = (shape: Shape, index: number) => shape.mirror !== "none" && onAxis(shape.points[index], ed.axis);
    if (hit?.kind === "handle") {
      const { knob } = hit;
      const { index, reflected } = knob.pointAsDrawn;
      ed.selection = { kind: "point", shape: knob.shape.id, index, ...copy(reflected), handle: knob.side };
      const tip = toScreen(ed.view, knob.tip);
      return { kind: "handle", knob, grab: { x: tip.x - from.x, y: tip.y - from.y }, alone, ...moving };
    }
    if (hit?.kind === "point") {
      const { shape, index, reflected } = hit;
      if (shape.id !== ed.state.drawing) {
        end();
        ed.selection = { kind: "point", shape: shape.id, index, ...copy(reflected) };
      }
      return { kind: "move", shape, index, reflected, snapped: held(shape, index), ...moving };
    }
    if (hit?.kind === "marker") {
      const { shape, index, reflected } = insert(hit.marker);
      ed.selection = { kind: "point", shape: shape.id, index, ...copy(reflected) };
      return { kind: "move", shape, index, reflected, snapped: held(shape, index), ...moving };
    }
    if (hit && ed.selection?.kind === "shape" && ed.selection.shape === hit.shape.id) {
      const whole = { index: null, reflected: hit.reflected, snapped: false };
      return { kind: "move", shape: hit.shape, ...whole, ...moving, loupe: false };
    }
    return { kind: "pan", from: ed.view };
  };

  /** A pan, from a drag on empty space or from anywhere (Space or the middle button): the page follows the pointer. */
  const panGesture = (g: Pick<PanGesture, "phase" | "from" | "at">) => {
    if (g.phase === "start") ed.drag = { kind: "pan", from: ed.view };
    if (ed.drag?.kind !== "pan") return;
    ed.view = { ...ed.drag.from, tx: ed.drag.from.tx + g.at.x - g.from.x, ty: ed.drag.from.ty + g.at.y - g.from.y };
    ed.moved = true;
    if (g.phase === "end" || g.phase === "cancel") ed.drag = null;
  };

  /**
   * A handle or stub dragged: its tip follows the finger, kept on the page; within `RETRACT_PX` of its point it's
   * removed. On a reflection, the shape's handle moves the mirrored way, so the tip stays under the finger. Shown
   * live, and one undo step when it ends.
   */
  const handleDrag = (g: DragGesture, d: Drag & { kind: "handle" }) => {
    d.at = g.at;
    if (g.phase === "cancel") {
      ed.selection = d.selection;
      ed.drag = null;
      return;
    }
    const { shape, base, o, k, side, pointAsDrawn } = d.knob;
    const tip = toDesignSpace(ed.view, { x: g.at.x + d.grab.x, y: g.at.y + d.grab.y });
    const clamped = { x: Math.min(ed.page.width, Math.max(0, tip.x)), y: Math.min(ed.page.height, Math.max(0, tip.y)) };
    const next = withKnob(d.knob, { x: clamped.x - base.x, y: clamped.y - base.y }, d.alone);
    d.live = ed.replace(next);
    if (g.phase !== "end") return;
    const kept = handleAt(next, o, k, side) ? { handle: side } : {};
    ed.selection = { kind: "point", shape: shape.id, index: pointAsDrawn.index, ...copy(pointAsDrawn.reflected), ...kept };
    if (JSON.stringify(next) !== JSON.stringify(shape)) change({ ...ed.state, shapes: d.live });
    ed.drag = null;
  };

  const dragGesture = (g: DragGesture) => {
    if (g.phase === "start") ed.drag = startDrag(g.from, g.pointerType, g.alt);
    if (!ed.drag) return;
    if (ed.drag.kind === "pan") return panGesture(g);
    if (ed.drag.kind === "handle") return handleDrag(g, ed.drag);
    if (ed.drag.kind !== "move") return;
    ed.drag.at = g.at;
    if (g.phase === "cancel") {
      ed.selection = ed.drag.selection;
      ed.drag = null;
      return;
    }
    const delta = { x: (g.at.x - g.from.x) / ed.view.scale, y: -(g.at.y - g.from.y) / ed.view.scale };
    const { shape: start, index } = ed.drag;
    const { shape, snapped } = movedBy(start, index, delta, ed.drag.reflected, ed.drag.snapped);
    ed.drag.snapped = snapped;
    ed.drag.live = ed.state.shapes.map((s) => (s.id === shape.id ? shape : s));
    if (g.phase !== "end") return;
    // A drag that moved nothing (held against the page's edge) is no change, unless it added a point.
    const added = !ed.state.shapes.includes(start);
    const same = shape.points.every((p, i) => p.x === start.points[i].x && p.y === start.points[i].y);
    if (added || !same) change({ ...ed.state, shapes: ed.drag.live });
    ed.drag = null;
  };

  /**
   * A touch hold: on a point or insert marker, a drag of it. Otherwise, where a tap would place a point (while
   * drawing, or on empty space with nothing selected), aim the loupe and place the point on lift. Anywhere else
   * (inside a shape with nothing being drawn, or with something selected) it waits: a tap if it lifts, a drag once
   * it moves.
   */
  const holdGesture = (g: HoldGesture) => {
    if (g.phase === "start") {
      const hit = hitTest(g.from);
      if (hit?.kind === "point" || hit?.kind === "handle" || hit?.kind === "marker") {
        return dragGesture({ ...g, type: "drag" });
      }
      const places = ed.state.drawing !== null || (!hit && !ed.selection);
      ed.drag = places ? { kind: "aim", at: g.at, snapped: placeAt(g.at).snapped } : { kind: "held" };
      return;
    }
    if (ed.drag?.kind === "aim") {
      ed.drag.at = g.at;
      ed.drag.snapped = placeAt(g.at, ed.drag.snapped).snapped;
      if (g.phase === "end") place(g.at, ed.drag.snapped);
      if (g.phase === "end" || g.phase === "cancel") ed.drag = null;
    } else if (ed.drag?.kind === "held") {
      if (g.phase === "move") return dragGesture({ ...g, type: "drag", phase: "start" });
      ed.drag = null;
      if (g.phase === "end") tap(g.from);
    } else dragGesture({ ...g, type: "drag" });
  };

  /** Escape: cancel the drag under way, putting back what it moved (or the view a pan moved). */
  const cancelDrag = () => {
    if (ed.drag?.kind === "move" || ed.drag?.kind === "handle") ed.selection = ed.drag.selection;
    if (ed.drag?.kind === "pan") ed.view = ed.drag.from;
    ed.drag = null;
  };

  /** Zoom by `factor` about the canvas's middle. */
  const zoomBy = (factor: number) => {
    const middle = { x: ed.size.width / 2, y: ed.size.height / 2 };
    ed.view = pinchZoom(ed.view, fitScale(ed.page, ed.size.width, ed.size.height), middle, middle, factor);
    ed.moved = true;
  };

  const key = ({ key: k, ctrl, shift }: KeyInput): boolean => {
    if (ed.finished || ed.size.width === 0) return false;
    endReframing();
    const lower = k.toLowerCase();
    const drawing = ed.state.drawing !== null;
    const can = (ok: boolean, act: () => void) => {
      if (ok) act();
      return ok;
    };
    if (ctrl) {
      if (lower === "z" && !shift) return can(history.can().undo, undo);
      if ((lower === "z" && shift) || lower === "y") return can(history.can().redo, redo);
      return false;
    }
    if (k === "Enter") {
      const shape = ed.drawingShape();
      if (shape) return can(true, shape.points.length >= 3 ? close : end);
      return can(openEnd() !== null, carryOn);
    }
    if (k === "Escape") {
      if (ed.drag) return can(true, cancelDrag);
      if (drawing) return can(true, end);
      return can(ed.selection !== null, () => (ed.selection = null));
    }
    if (k === "Delete" || k === "Backspace") {
      if (ed.selection) return can(true, remove);
      return can(k === "Backspace" && drawing, removeLast);
    }
    if (lower === "s") return can(ed.selection?.kind === "point" && !drawing, toggleSelected);
    if (lower === "m") return can(true, toggleSymmetry);
    if (k === "+" || k === "=") return can(true, () => zoomBy(KEY_ZOOM_STEP));
    if (k === "-") return can(true, () => zoomBy(1 / KEY_ZOOM_STEP));
    if (k === "0") {
      ed.moved = false;
      ed.view = fitView(ed.page, ed.size.width, ed.size.height);
      return true;
    }
    const arrow = ARROWS.get(k);
    if (!arrow) return false;
    const step = shift ? SHIFT_NUDGE_PX : NUDGE_PX;
    return nudge({ x: arrow.x * step, y: arrow.y * step });
  };

  const gesture = (g: Gesture) => {
    if (g.type === "hover") {
      ed.pointer = g.at && { at: g.at, pans: g.pans };
      return;
    }
    if (ed.finished || ed.size.width === 0) return;
    endReframing();
    // A mouse or pen still hovers where its drag ended.
    const ends = (g.type === "drag" || g.type === "pan") && (g.phase === "end" || g.phase === "cancel");
    if (ends && g.pointerType !== "touch") ed.pointer = { at: g.at, pans: ed.pointer?.pans ?? false };
    const fit = () => fitScale(ed.page, ed.size.width, ed.size.height);
    const zoomTo = (next: ViewTransform) => {
      ed.view = next;
      ed.moved = true;
    };
    if (g.type === "tap") firstTap(g.at);
    else if (g.type === "doubleTap") doubleTap(g.at);
    else if (g.type === "drag") dragGesture(g);
    else if (g.type === "hold") holdGesture(g);
    else if (g.type === "pan") panGesture(g);
    else if (g.type === "multiTap") (g.fingers === 2 ? undo : redo)();
    else if (g.type === "wheel") zoomTo(wheelZoom(ed.view, fit(), g.at, g.deltaY));
    else if (g.type === "pinch") zoomTo(pinchZoom(ed.view, fit(), g.from, g.at, g.scale));
  };

  return { gesture, key };
}
