import type { BBox, Design, TemplateWarning } from "../core";
import { copy, createEditor, type Drag, type Selection, type State } from "./context";
import type { XY } from "./curves";
import { createEdits } from "./edits";
import type { DragGesture, Gesture, HoldGesture, PanGesture, PointerKind, ScreenPoint } from "./gestures";
import { createHistory, type Steps } from "./history";
import { createHits } from "./hits";
import { placeLoupe, type Loupe } from "./loupe";
import type { HandTraceRecord, Page, Point, Shape } from "./model";
import { loopsPathData, pathData } from "./pathData";
import { onAxis } from "./symmetry";
import { fitScale, fitView, pinchZoom, toDesignSpace, toScreen, wheelZoom, type ViewTransform } from "./view";

/**
 * The cleanup under a photo's hand-trace (ADR 0003), which the editor holds as one of the things an undo step puts
 * back. `C` is the cleanup as the app keeps it; the editor only hands it back.
 */
export interface HandTraceCleanup<C> {
  /** The cleanup the points are placed over to begin with (as the stored record restores it). */
  start: C;
  /** The design space cleanup `c` makes: the cleaned-up photo's page. */
  page(c: C): Page;
  /**
   * Where a design-space position under cleanup `from` lands under `to`: the old cleanup undone and the new one
   * applied, so it stays on the same spot of the photo.
   */
  carry(from: C, to: C): (p: XY) => XY;
}

/** What the editor needs from outside. */
export interface HandTraceOptions<C = unknown> {
  /**
   * The one route from path data (SVG space, y down) to the core's `Design`: `designFromPathData` in `src/input`,
   * which flattens at the loader's tolerance. Passed in because the editor can't import outside the core.
   */
  toDesign: (pathData: string) => Design | null;
  /** The page the points are placed on; a blank page (1 × 1) when left out, or the cleanup's page with one. */
  page?: Page;
  /** The cleanup under a photo, which `changeCleanup` changes; none for a blank page or an edited SVG design. */
  cleanup?: HandTraceCleanup<C>;
  /** The stored record to reopen (validated by the record module), as after a reload; nothing drawn when left out. */
  record?: HandTraceRecord;
  /**
   * The points are placed over the cleaned-up photo (`page` being its design space), not on a blank page: no grid,
   * and the symmetry axis only while it's needed.
   */
  photo?: boolean;
}

/** A key press: `KeyboardEvent.key`, with Ctrl (or Cmd on a Mac) and Shift as held. */
export interface KeyInput {
  key: string;
  ctrl: boolean;
  shift: boolean;
}

/** A screen rectangle, in CSS pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One shape as drawn: its edge as screen path data, dashed while open. */
export interface DrawnShape {
  id: number;
  d: string;
  closed: boolean;
  /** It's the shape being drawn. */
  drawing: boolean;
  /** It's the selected shape, or the selected point's shape: highlighted. */
  selected: boolean;
}

/** One point as drawn. */
export interface DrawnPoint {
  at: ScreenPoint;
  kind: Point["kind"];
  /** One of an open shape's two end points, marked so the carver sees it isn't closed. */
  end: boolean;
  /** The first point of the shape being drawn, once a tap on it would close the shape. */
  closable: boolean;
  selected: boolean;
}

/**
 * One handle as drawn, from its point to its tip: the selected point's `own` (solid, on top), its neighbours' on its
 * two edges (`neighbour`: faint, hollow and smaller), or a `stub` (dashed) on a selected corner's side without a
 * handle, which a drag pulls a handle out of. `selected` for the handle arrow keys nudge.
 */
export interface DrawnHandle {
  from: ScreenPoint;
  to: ScreenPoint;
  kind: "own" | "neighbour" | "stub";
  selected: boolean;
}

/**
 * What the floating pill offers: the point count with Close and End while drawing; Delete point, Smooth / Corner
 * (`smooth` says which the point is), Carry on (on an open end) and clearing the selection with a point selected;
 * Delete shape and clearing with a shape selected; otherwise a hint.
 */
export type Pill =
  | { kind: "drawing"; points: number; canClose: boolean }
  | { kind: "point"; canCarryOn: boolean; smooth: boolean }
  | { kind: "shape" }
  | { kind: "hint"; text: string };

/**
 * The shape warnings marked where they are, so the carver can find and fix them. Display only: never hit. They're
 * placed from the positions the core's warnings carry for the Design, so whatever the Design holds is marked:
 * reflections too, once mirrored shapes reach it through the path data.
 */
export interface WarningMarks {
  /** Each crossing, for a small ring round it. */
  crossings: ScreenPoint[];
  /** Each floating piece as path data, its loops filled even-odd, for a faint tint over it. */
  floating: string[];
  /** Each tiny carve area as the circle through its box's corners (radius `r` px), for a ring round it. */
  tiny: { at: ScreenPoint; r: number }[];
}

/** Shapes and their reflections as path data, the closed ones apart from the open ones. */
export interface ShapePaths {
  closed: string;
  open: string;
}

/** Everything the canvas shows, in screen coordinates. */
export interface Drawn {
  /** The blank page or the cleaned-up photo. */
  page: ScreenRect;
  /** The page is faintly gridded: a blank page is, so pan and zoom show; a photo isn't. */
  grid: boolean;
  /**
   * The symmetry axis, down the page's middle: always on a blank page; over a photo, while Symmetry is on or a
   * mirrored shape is selected or being drawn. `snapped` (highlighted) while a point being placed or dragged is
   * snapped onto it, or where a hovering click would place one.
   */
  axis: { from: ScreenPoint; to: ScreenPoint; snapped: boolean } | null;
  /** Every closed shape's edge in one path, filled even-odd: what's carved. */
  fill: string;
  shapes: DrawnShape[];
  points: DrawnPoint[];
  /** The selected point's handles and stubs, and its neighbours' handles on its edges; none otherwise. */
  handles: DrawnHandle[];
  pill: Pill;
  /** The selected shape's insert markers, while no shape is being drawn. */
  markers: ScreenPoint[];
  /** "1 shape isn't closed and won't be carved" while any open shape exists. */
  note: string | null;
  /** Which of the Undo, Redo and Clear buttons can act. */
  can: { undo: boolean; redo: boolean; clear: boolean };
  /** The tools (buttons, pill, note) show and the canvas takes input: false once Done. */
  tools: boolean;
  /** The Symmetry setting is on: its button shows pressed. */
  symmetry: boolean;
  /** The shape warnings last shown for the Design. */
  warnings: WarningMarks;
  /** The loupe, while a finger holds to place a point or drags one; never for a mouse or pen. */
  loupe: Loupe | null;
  /** What a click where the mouse or pen hovers would act on, highlighted; null over empty space or with none. */
  hover: HoverMark | null;
  /** The pointer's cursor over the canvas: what a click or press there would do. */
  cursor: Cursor;
  /** While a shape is being drawn, its dashed edge from the last point to where a click would place (or close). */
  rubberBand: { from: ScreenPoint; to: ScreenPoint } | null;
}

/** What a hovering click would act on: a point, handle or insert marker where it's drawn, or a shape by its id. */
export type HoverMark = { kind: "point" | "handle" | "marker"; at: ScreenPoint } | { kind: "shape"; id: number };

/**
 * The cursor: a crosshair where a click places a point, a pointer where it selects, closes or ends, a move cursor
 * on the selected shape, an open hand where a press pans (Space held) and a closed one while panning or moving.
 */
export type Cursor = "default" | "crosshair" | "pointer" | "move" | "grab" | "grabbing";

/** The hand-trace editor: commands and gestures in; what's drawn, the `Design` and the shapes out. */
export interface HandTrace<C = unknown> {
  /** The canvas is now `width` × `height` px; the page refits unless the carver has panned or zoomed. */
  resize(width: number, height: number): void;
  gesture(g: Gesture): void;
  /**
   * A key pressed while the canvas has focus. True when it did something, so the canvas keeps it from the browser;
   * false for keys that aren't the editor's or that had nothing to act on.
   */
  key(k: KeyInput): boolean;
  /** The pill's Close: close the shape being drawn (3 points or more). */
  close(): void;
  /** The pill's End: end the shape being drawn open. Not an undo step. */
  end(): void;
  /**
   * The pill's Delete point or Delete shape, as one undo step. A point between curves leaves one curve fitted to
   * both. A shape left too small goes too: a closed shape under 3 points, or an open shape with none.
   */
  delete(): void;
  /** The pill's Carry on: with an open shape's end point selected, carry on drawing that shape from it. */
  carryOn(): void;
  /** The pill's ✕: select nothing. */
  clearSelection(): void;
  /** The pill's Smooth / Corner: switch the selected point's kind, as one undo step. */
  toggleKind(): void;
  /**
   * The Symmetry button: switch the setting that makes each shape started while it's on a mirrored one. Shapes
   * already started keep theirs. Not an undo step; the stored record keeps it.
   */
  toggleSymmetry(): void;
  /** Remove every shape, as one undo step. */
  clear(): void;
  /**
   * Edit as hand-trace's copy: put `shapes` in place of every shape, as one undo step, with nothing being drawn or
   * selected. Each gets an id of its own.
   */
  replace(shapes: readonly Shape[]): void;
  /**
   * A cleanup change: the photo under the points is now cleaned up by `cleanup`, so every point and handle is
   * carried to stay on its spot of the photo, and the page becomes the new cleaned-up photo's. `live` while a frame
   * corner is dragged (or nudged, or Turn moves): shown as it would end, always carried from the cleanup before the
   * drag, and kept out of the `Design` and the record. Each released change (`live` false) is one undo step, which
   * puts the old cleanup back too; a release with the cleanup from before the drag is none. Only with the `cleanup`
   * option.
   */
  changeCleanup(cleanup: C, live: boolean): void;
  /** The cleanup the points are over now, as the last change, undo or redo left it; null without the option. */
  cleanup(): C | null;
  undo(): void;
  redo(): void;
  /** Done: end the shape being drawn open, hide the tools and stop taking input. */
  done(): void;
  /** Edit: back to tracing after Done. */
  edit(): void;
  isDone(): boolean;
  drawn(): Drawn;
  /** The closed shapes as the core's `Design`; null with none that encloses an area. A new object only on change. */
  design(): Design | null;
  /**
   * The closed shapes as SVG path data (y down; empty with none closed): what the `Design` is made from, and what a
   * hand-trace file draws.
   */
  pathData(): string;
  /**
   * Every shape and reflection as path data with each position (points and handle tips) mapped through `map`, the
   * closed ones apart from the open ones: what Cleanup draws over the photo, where they can't be edited. Live
   * through a cleanup change, as `drawn` is.
   */
  shapePaths(map: (p: XY) => XY): ShapePaths;
  /** The shapes, in the order drawn, as the stored record holds them. */
  shapes(): readonly Shape[];
  /** What the stored record keeps of the hand-trace. A new object only on a finished change or Done/Edit. */
  record(): HandTraceRecord;
  /** The photo or page the points are placed on, which the stored record keeps beside them. */
  page(): Page;
  /** How many points there are in all, and how many shapes are open. */
  counts(): { points: number; open: number };
  /** The core's warnings for the Design: its shape warnings are marked where they are. */
  showWarnings(warnings: readonly TemplateWarning[]): void;
}

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
/** The pill's hint when nothing is being drawn. */
const HINT = "Tap to place a point.";

/** Everything a tap may change, kept so a double-tap can take the tap back. */
interface Before extends Steps {
  state: State;
  selection: Selection | null;
  nextId: number;
}

export function createHandTrace<C = unknown>(options: HandTraceOptions<C>): HandTrace<C> {
  const ed = createEditor(options);
  const history = createHistory(ed, options.cleanup);
  const { committed, change, changeCleanup, endReframing, undo, redo } = history;
  const hits = createHits(ed);
  const { hitTest, pointOrHandleAt, pointAt, knobs, markers, handleAt, tapAction } = hits;
  const { placeAt, place, close, end, openEnd, carryOn, remove, insert, toggleSymmetry, toggled, toggleSelected, withKnob, movedBy, nudge, removeLast } = createEdits(ed, history, hits);
  /** The record last handed out, and what it was made from. */
  let recordOf: { state: State; finished: boolean; symmetry: boolean; record: HandTraceRecord } | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;
  /** The warnings last shown, and the Design they were for: once that changes, they're out of date. */
  let warnings: { design: Design | null; warnings: readonly TemplateWarning[] } | null = null;
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

  // SVG space is y down: flip on the way out, as the loader flips back.
  const closedPathData = () => {
    const { shapes, page: under } = committed();
    return pathData(
      shapes.filter((s) => s.closed),
      ({ x, y }) => ({ x, y: -y }),
      under.width / 2,
    );
  };
  /**
   * The Design from the closed shapes' path data. With a mirrored shape among them its box is widened evenly about
   * the axis, so placement centres the axis on the pumpkin's front (ADR 0004).
   */
  const design = (): Design | null => {
    const { shapes, page: under } = committed();
    if (designOf?.shapes !== shapes) {
      const d = closedPathData();
      const made = d ? options.toDesign(d) : null;
      const mirrored = shapes.some((s) => s.closed && s.mirror !== "none");
      designOf = { shapes, design: made && mirrored ? aboutAxis(made, under.width / 2) : made };
    }
    return designOf.design;
  };

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

  /** Where the mouse or pen hovers: what a click there would act on, the cursor, and the rubber band. */
  const hovering = (): Pick<Drawn, "hover" | "cursor" | "rubberBand"> => {
    const none = { hover: null, rubberBand: null };
    if (ed.finished || !ed.pointer) return { ...none, cursor: "default" };
    if (ed.drag) return { ...none, cursor: "grabbing" };
    if (ed.pointer.pans) return { ...none, cursor: "grab" };
    const action = tapAction(ed.pointer.at);
    const last = ed.drawingShape()?.points.at(-1);
    const band = (to: { x: number; y: number }) => (last ? { from: toScreen(ed.view, last), to: toScreen(ed.view, to) } : null);
    if (action.do === "place") return { hover: null, cursor: "crosshair", rubberBand: band(placeAt(ed.pointer.at).point) };
    if (action.do === "deselect" || action.do === "nothing") return { ...none, cursor: "default" };
    const { hit } = action;
    if (hit.kind === "shape") {
      const picked = ed.selection?.kind === "shape" && ed.selection.shape === hit.shape.id;
      return { hover: { kind: "shape", id: hit.shape.id }, cursor: picked ? "move" : "pointer", rubberBand: null };
    }
    if (hit.kind === "handle") {
      return { hover: { kind: "handle", at: toScreen(ed.view, hit.knob.tip) }, cursor: "move", rubberBand: null };
    }
    const at = hit.kind === "point" ? ed.findAsDrawn(hit.shape, hit.index, hit.reflected)!.at : hit.marker.at;
    const rubberBand = action.do === "close" ? band(at) : null;
    return { hover: { kind: hit.kind, at: toScreen(ed.view, at) }, cursor: "pointer", rubberBand };
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

  /**
   * A point being placed or dragged is snapped onto the axis, so it's highlighted; while hovering, where a click
   * would place one.
   */
  const snapping = (): boolean => {
    if (ed.drag?.kind === "aim") return ed.drag.snapped;
    if (ed.drag?.kind === "move") return ed.drag.index !== null && ed.drag.snapped;
    if (ed.drag || ed.finished || !ed.pointer || ed.pointer.pans) return false;
    return tapAction(ed.pointer.at).do === "place" && placeAt(ed.pointer.at).snapped;
  };

  /** The loupe for the drag or hold under way, if it's by touch and aims at a point: clear of the finger. */
  const loupe = (shapes: readonly Shape[]): Loupe | null => {
    if (ed.drag?.kind === "aim") return loupeAt(ed.drag.at, toScreen(ed.view, placeAt(ed.drag.at, ed.drag.snapped).point));
    if (ed.drag?.kind === "handle" && ed.drag.loupe) {
      // Centred on the handle's tip, or on its point once it's dragged back onto it.
      const { shape, o, k, side, base: p } = ed.drag.knob;
      const h = handleAt(shapes.find((s) => s.id === shape.id) ?? shape, o, k, side);
      return loupeAt(ed.drag.at, toScreen(ed.view, h ? { x: p.x + h.x, y: p.y + h.y } : p));
    }
    if (ed.drag?.kind !== "move" || !ed.drag.loupe || ed.drag.index === null) return null;
    const { shape, index, reflected } = ed.drag;
    const found = ed.findAsDrawn(shapes.find((s) => s.id === shape.id) ?? shape, index, reflected);
    return found && loupeAt(ed.drag.at, toScreen(ed.view, found.at));
  };
  const loupeAt = (finger: ScreenPoint, focus: ScreenPoint): Loupe => placeLoupe(finger, focus, ed.size.width);

  const pill = (): Pill => {
    const shape = ed.drawingShape();
    if (shape) return { kind: "drawing", points: shape.points.length, canClose: shape.points.length >= 3 };
    if (ed.selection?.kind === "point") {
      const { shape: id, index } = ed.selection;
      const smooth = ed.state.shapes.find((s) => s.id === id)?.points[index]?.kind === "smooth";
      return { kind: "point", canCarryOn: openEnd() !== null, smooth };
    }
    if (ed.selection?.kind === "shape") return { kind: "shape" };
    return { kind: "hint", text: HINT };
  };

  const drawn = (): Drawn => {
    const screen = (p: { x: number; y: number }) => toScreen(ed.view, p);
    /** The circle through a box's corners, on screen. */
    const ring = (box: BBox) => ({
      at: screen({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }),
      r: (Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2) * ed.view.scale,
    });
    // Marked only for the Design they were found in; a move under way keeps them where they were.
    const current = warnings?.design === design() ? warnings.warnings : [];
    const corner = screen({ x: 0, y: ed.page.height });
    // A move under way shows as it would end.
    const shapes = ((ed.drag?.kind === "move" || ed.drag?.kind === "handle") && ed.drag.live) || ed.state.shapes;
    const picked = ed.selection?.kind === "point" ? ed.selection : null;
    const handles = knobs(shapes).map(({ base, side, tip, stub, role }) => ({
      from: screen(base),
      to: screen(tip),
      kind: stub ? ("stub" as const) : role,
      selected: !stub && role === "own" && picked?.handle === side,
    }));
    const chosen = picked && shapes.find((s) => s.id === picked.shape);
    const pickedAsDrawn = chosen && ed.findAsDrawn(chosen, picked.index, !!picked.reflected);
    const open = shapes.filter((s) => !s.closed).length;
    const mirrored = (id: number | null | undefined) => shapes.some((s) => s.id === id && s.mirror !== "none");
    // The axis shows over a photo only while it's needed: Symmetry on, or a mirrored shape picked or being drawn.
    const showsAxis = !options.photo || ed.symmetry || mirrored(ed.selection?.shape) || mirrored(ed.state.drawing);
    return {
      page: { ...corner, width: ed.page.width * ed.view.scale, height: ed.page.height * ed.view.scale },
      grid: !options.photo,
      axis: showsAxis
        ? { from: screen({ x: ed.axis, y: ed.page.height }), to: screen({ x: ed.axis, y: 0 }), snapped: snapping() }
        : null,
      fill: pathData(
        shapes.filter((s) => s.closed),
        screen,
        ed.axis,
      ),
      shapes: shapes.map((s) => ({
        id: s.id,
        d: pathData([s], screen, ed.axis),
        closed: s.closed,
        drawing: s.id === ed.state.drawing,
        selected: s.id === ed.selection?.shape,
      })),
      // Reflections' points too, as the drawn side's.
      points: shapes.flatMap((s) =>
        ed.asDrawn(s).flatMap((shapeAsDrawn, o) =>
          shapeAsDrawn.pointsAsDrawn.map(({ index: i }, k) => ({
            at: screen(shapeAsDrawn.shape.points[k]),
            kind: s.points[i].kind,
            end: !s.closed && (i === 0 || i === s.points.length - 1),
            closable: s.id === ed.state.drawing && i === 0 && s.points.length >= 3,
            selected: chosen === s && pickedAsDrawn?.o === o && pickedAsDrawn.k === k,
          })),
        ),
      ),
      handles,
      pill: pill(),
      markers: markers(shapes).map((m) => screen(m.at)),
      note: open === 0 ? null : `${open} ${open === 1 ? "shape isn't" : "shapes aren't"} closed and won't be carved`,
      can: { ...history.can(), clear: ed.state.shapes.length > 0 },
      tools: !ed.finished,
      symmetry: ed.symmetry,
      warnings: {
        crossings: current.flatMap((w) => (w.kind === "crossing" ? w.at.map(screen) : [])),
        floating: current.flatMap((w) =>
          w.kind === "floating-piece" ? w.pieces.map((piece) => loopsPathData(piece.outline, screen)) : [],
        ),
        tiny: current.flatMap((w) => (w.kind === "tiny-carve-area" ? w.areas.map(({ bbox }) => ring(bbox)) : [])),
      },
      loupe: loupe(shapes),
      ...hovering(),
    };
  };

  return {
    resize(width, height) {
      ed.size = { width, height };
      if (!ed.moved && width > 0 && height > 0) ed.view = fitView(ed.page, width, height);
    },
    gesture,
    key,
    close: () => !ed.finished && close(),
    end: () => !ed.finished && end(),
    delete: () => !ed.finished && remove(),
    carryOn: () => !ed.finished && carryOn(),
    clearSelection() {
      ed.selection = null;
    },
    toggleKind: () => !ed.finished && toggleSelected(),
    toggleSymmetry: () => !ed.finished && toggleSymmetry(),
    clear() {
      if (ed.finished || ed.state.shapes.length === 0) return;
      change({ ...ed.state, shapes: [], drawing: null });
      ed.selection = null;
    },
    replace(shapes) {
      if (ed.finished) return;
      change({ ...ed.state, shapes: shapes.map((s) => ({ ...s, id: ed.nextId++ })), drawing: null });
      ed.selection = null;
    },
    undo,
    redo,
    done() {
      end();
      ed.selection = null;
      ed.drag = null;
      ed.finished = true;
    },
    edit() {
      ed.finished = false;
    },
    isDone: () => ed.finished,
    drawn,
    design,
    pathData: closedPathData,
    shapePaths: (map) => ({
      closed: pathData(
        ed.state.shapes.filter((s) => s.closed),
        map,
        ed.axis,
      ),
      open: pathData(
        ed.state.shapes.filter((s) => !s.closed),
        map,
        ed.axis,
      ),
    }),
    shapes: () => ed.state.shapes,
    record() {
      const shown = committed();
      if (recordOf?.state !== shown || recordOf.finished !== ed.finished || recordOf.symmetry !== ed.symmetry) {
        const record = { shapes: [...shown.shapes], drawing: shown.drawing, done: ed.finished, ...(ed.symmetry && { symmetry: ed.symmetry }) };
        recordOf = { state: shown, finished: ed.finished, symmetry: ed.symmetry, record };
      }
      return recordOf.record;
    },
    page: () => ed.page,
    changeCleanup,
    cleanup: () => ed.state.cleanup as C | null,
    counts: () => ({
      points: ed.state.shapes.reduce((n, s) => n + s.points.length, 0),
      open: ed.state.shapes.filter((s) => !s.closed).length,
    }),
    showWarnings(next) {
      warnings = { design: design(), warnings: next };
    },
  };
}

/** `design` with its box widened evenly about the axis at x = `axis`, so the axis is its middle. */
function aboutAxis(design: Design, axis: number): Design {
  const half = Math.max(axis - design.bbox.minX, design.bbox.maxX - axis);
  return { ...design, bbox: { ...design.bbox, minX: axis - half, maxX: axis + half } };
}
