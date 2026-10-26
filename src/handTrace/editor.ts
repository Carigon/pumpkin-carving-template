import { distanceToSegment, insidePolygon, polylineLength, signedArea, type BBox, type Design, type TemplateWarning } from "../core";
import type { DragGesture, Gesture, HoldGesture, PanGesture, PointerKind, ScreenPoint } from "./gestures";
import {
  edgeAt,
  edgePolyline,
  edgesOf,
  handlesOf,
  neighbour,
  split,
  toggleKind,
  withHandle,
  withoutPoint,
  type Edge,
  type Side,
  type XY,
} from "./curves";
import { carried } from "./carry";
import type { HandTraceRecord, Page, Point, Shape } from "./model";
import { loopsPathData, pathData } from "./pathData";
import {
  actingHandle,
  closed,
  editMirrored,
  keptToSide,
  mirrorOffset,
  onAxis,
  sideOf,
  type PointAsDrawn,
} from "./symmetry";
import { copy, createEditor, type Drag, type Selection, type State } from "./context";
import { placeLoupe, type Loupe } from "./loupe";
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

/**
 * Screen radius (px) within which a tap hits a point or a shape's edge, whatever the zoom; the axis snap's too, and
 * Cleanup's frame corners'.
 */
export const HIT_RADIUS_PX = 22;
/** How many hit radii a snapped point is dragged off the axis before it lets go: clearly past the snap. */
const SNAP_RELEASE = 1.5;
/** Edges shorter than this on screen (px), measured along the curve, show no insert marker. */
const MARKER_MIN_EDGE_PX = 48;
/** How far out (screen px) a corner's stub reaches along its edge. */
const STUB_PX = 40;
/** A handle dragged this close (screen px) to its point is removed. */
const RETRACT_PX = 10;
/** Straight pieces a curved edge is taken as for hits, markers and the inside test. */
const CURVE_PIECES = 16;
/** A symmetric shape enclosing no more than this, as a fraction of the page's area, encloses none: it's deleted. */
const NO_AREA = 1e-12;
/** Undo steps kept; older ones are dropped. */
const UNDO_LIMIT = 200;
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

/**
 * What's under a tap or the start of a drag: a point (its shape and index), a handle or stub, an insert marker, or a
 * shape by its edge or inside. `reflected` when it's a mirrored shape's reflection that's under it.
 */
type Hit =
  | { kind: "point"; shape: Shape; index: number; reflected: boolean }
  | { kind: "handle"; knob: Knob }
  | { kind: "marker"; marker: Marker }
  | { kind: "shape"; shape: Shape; reflected: boolean };

/**
 * A handle or stub showing for the selected point, in design space: on `side` of `pointAsDrawn` (the `k`th point of
 * the shape as drawn `o`), from `base` to `tip`; `source` says which of the shape's handles that is, and whether the
 * drawing mirrors it. `role` is the selected point's own, or a neighbour's on one of its edges.
 */
export interface Knob {
  shape: Shape;
  o: number;
  k: number;
  pointAsDrawn: PointAsDrawn;
  side: Side;
  source: { side: Side; mirrored: boolean };
  base: XY;
  tip: XY;
  stub: boolean;
  role: "own" | "neighbour";
}

/**
 * An insert marker, in design space: in the middle of `shape`'s edge from point `after` to the next, or of a
 * symmetric shape's straight `join` across the axis at its half's start or end; `reflected` when it's drawn on the
 * reflection.
 */
interface Marker {
  shape: Shape;
  at: XY;
  reflected: boolean;
  insert: { after: number } | { join: "start" | "end" };
}

/**
 * What a tap or click at a spot would do, and what it would act on: place a point; close or end the shape being
 * drawn on its first or last point; select a point or shape (ending the shape being drawn); add a point at an
 * insert marker; clear the selection; or nothing. One rule for tapping and for showing a hover.
 */
type TapAction =
  | { do: "place" }
  | { do: "close" | "end"; hit: Hit & { kind: "point" } }
  | { do: "select"; hit: Hit; selection: Selection }
  | { do: "insert"; hit: Hit & { kind: "marker" } }
  | { do: "deselect" }
  | { do: "nothing" };

/** Everything a tap may change, kept so a double-tap can take the tap back. */
interface Before {
  state: State;
  undo: State[];
  redo: State[];
  selection: Selection | null;
  nextId: number;
}

export function createHandTrace<C = unknown>(options: HandTraceOptions<C>): HandTrace<C> {
  const cleanups = options.cleanup;
  const ed = createEditor(options);
  /**
   * A run of live cleanup changes under way: the state before it, which every change in the run is carried from and
   * which the `Design` and the record still show; null with none.
   */
  let reframing: { from: State } | null = null;
  const undoStack: State[] = [];
  let redoStack: State[] = [];
  /** The record last handed out, and what it was made from. */
  let recordOf: { state: State; finished: boolean; symmetry: boolean; record: HandTraceRecord } | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;
  /** The warnings last shown, and the Design they were for: once that changes, they're out of date. */
  let warnings: { design: Design | null; warnings: readonly TemplateWarning[] } | null = null;
  /**
   * The shapes and selection the last arrow nudge left. While both are still those (nothing else has changed or
   * selected since), the next nudge joins its undo step: a run of presses is one step.
   */
  let nudged: { state: State; selection: Selection } | null = null;
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

  /** The state the `Design` and the record show: the one before a run of live cleanup changes, while there's one. */
  const committed = () => reframing?.from ?? ed.state;
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

  /**
   * A cleanup change: the shapes carried from the state before any live run under way, onto `cleanup`'s page.
   * Live, it's shown; released, it's one undo step from that state, unless it's that state's own cleanup.
   */
  const changeCleanup = (cleanup: C, live: boolean) => {
    if (!cleanups) return;
    const from = committed();
    const map = cleanups.carry(from.cleanup as C, cleanup);
    const to = cleanups.page(cleanup);
    const shapes = from.shapes.map((s) => carried(s, map, to.width / 2));
    const next = { ...from, shapes, page: to, cleanup };
    ed.drag = null;
    if (live) {
      reframing = { from };
      return ed.setState(next);
    }
    reframing = null;
    ed.setState(from);
    if (cleanup !== from.cleanup) change(next);
  };
  /** A live cleanup run something else interrupts: it stands as it got, as one undo step. */
  const endReframing = () => {
    if (!reframing) return;
    undoStack.push(reframing.from);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    reframing = null;
  };
  /** Make a change to the shapes, as one undo step. A move under way is dropped: it was built on the old shapes. */
  const change = (next: State) => {
    endReframing();
    ed.drag = null;
    undoStack.push(ed.state);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    ed.setState(next);
  };

  /**
   * Design-space position `p` clamped to the page, and for a point of mirrored `shape` (its point `skip` the one
   * moving) kept to the shape's side of the axis.
   */
  const keep = (p: XY, shape: Shape | null, skip = -1): XY => {
    const x = Math.min(ed.page.width, Math.max(0, p.x));
    const y = Math.min(ed.page.height, Math.max(0, p.y));
    return { x: shape && shape.mirror !== "none" ? keptToSide(x, sideOf(shape, ed.axis, skip), ed.axis) : x, y };
  };
  /**
   * `p` kept (as `keep` does) and, for a point of a mirrored shape being drawn or dragged, snapped onto the axis
   * within the hit radius, or the wider release distance while `held` there already. `snapped` once it's on the axis.
   */
  const constrain = (p: XY, shape: Shape | null, mirrored: boolean, skip = -1, held = false) => {
    const x = Math.min(ed.page.width, Math.max(0, p.x));
    const near = mirrored && Math.abs(x - ed.axis) * ed.view.scale < HIT_RADIUS_PX * (held ? SNAP_RELEASE : 1);
    const q = keep({ x: near ? ed.axis : x, y: p.y }, mirrored ? shape : null, skip);
    return { ...q, snapped: mirrored && q.x === ed.axis };
  };

  /** Whether a point placed now is a mirrored shape's: the shape being drawn's, or (with none) a new one's. */
  const placingMirrored = () => {
    const shape = ed.drawingShape();
    return shape ? shape.mirror !== "none" : ed.symmetry;
  };

  /** A screen position as a point placed on the page: clamped to it; for a mirrored shape, snapped and kept to its side. */
  const placeAt = (at: ScreenPoint, held = false): { point: Point; snapped: boolean } => {
    const { x, y, snapped } = constrain(toDesignSpace(ed.view, at), ed.drawingShape(), placingMirrored(), -1, held);
    return { point: { x, y, kind: "corner" }, snapped };
  };

  /**
   * Place a point (`held` on the axis already, as a hold aims): on the shape being drawn, or starting one. A mirrored
   * shape started on the axis closes by itself as it lands on the axis again, with points off it to mirror.
   */
  const place = (at: ScreenPoint, held = false) => {
    const { point } = placeAt(at, held);
    const shape = ed.drawingShape();
    if (shape) {
      const grown = { ...shape, points: [...shape.points, point] };
      const on = (p: XY) => onAxis(p, ed.axis);
      const lands = shape.mirror !== "none" && on(point) && on(shape.points[0]) && grown.points.length >= 3;
      if (lands && !grown.points.every(on)) change({ ...ed.state, shapes: ed.replace(closed(grown, ed.axis)), drawing: null });
      else change({ ...ed.state, shapes: ed.replace(grown) });
    } else {
      const id = ed.nextId++;
      const mirror = ed.symmetry ? "twin" : "none";
      change({ ...ed.state, shapes: [...ed.state.shapes, { id, closed: false, mirror, points: [point] }], drawing: id });
    }
  };

  const close = () => {
    const shape = ed.drawingShape();
    if (!shape || shape.points.length < 3) return;
    change({ ...ed.state, shapes: ed.replace(closed(shape, ed.axis)), drawing: null });
  };
  const end = () => {
    if (ed.state.drawing !== null) ed.state = { ...ed.state, drawing: null };
  };

  /** The selected point's shape, if the point is one of an open shape's two ends. */
  const openEnd = (): Shape | null => {
    if (ed.selection?.kind !== "point") return null;
    const { shape: id, index } = ed.selection;
    const shape = ed.state.shapes.find((s) => s.id === id);
    return shape && !shape.closed && (index === 0 || index === shape.points.length - 1) ? shape : null;
  };
  const carryOn = () => {
    const shape = openEnd();
    if (!shape) return;
    // Drawing always adds at the last point, so carrying on from the first turns the shape round.
    const turned = ed.selection?.kind === "point" && ed.selection.index === 0 && shape.points.length > 1;
    const shapes = turned ? ed.replace({ ...shape, points: [...shape.points].reverse() }) : ed.state.shapes;
    ed.state = { ...ed.state, shapes, drawing: shape.id };
    ed.selection = null;
    ed.drag = null;
  };

  /**
   * Whether closed `shape` is too small to keep: under 3 points, or for a symmetric shape, counted whole, under 3
   * distinct points or enclosing no area.
   */
  const tooSmall = (shape: Shape): boolean => {
    if (shape.mirror !== "symmetric") return shape.points.length < 3;
    const [whole] = ed.asDrawn(shape);
    const poly = edgesOf(whole.shape).flatMap((e) => edgePolyline(e, CURVE_PIECES).slice(1));
    return whole.pointsAsDrawn.length < 3 || Math.abs(signedArea(poly)) <= NO_AREA * ed.page.width * ed.page.height;
  };

  /** Delete the selected point (its source, if it's on a reflection) or shape, and a shape the point leaves too small. */
  const remove = () => {
    const picked = ed.selection;
    const shape = picked && ed.state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    const i = picked.kind === "point" ? picked.index : -1;
    const left = i >= 0 ? editMirrored(shape, ed.axis, [i - 1, i, i + 1], (s) => withoutPoint(s, i)) : { ...shape, points: [] };
    const gone = left.points.length === 0 || (shape.closed && tooSmall(left));
    const shapes = gone ? ed.state.shapes.filter((s) => s !== shape) : ed.replace(left);
    change({ ...ed.state, shapes });
    ed.selection = null;
  };

  /**
   * After an undo or redo from `from`: keep the selection while its shape is still there with as many points, so
   * a point index still means the same point, and nothing is being drawn.
   */
  const settle = (from: State) => {
    const find = (shapes: readonly Shape[]) => ed.selection && shapes.find((s) => s.id === ed.selection?.shape);
    const [was, now] = [find(from.shapes), find(ed.state.shapes)];
    if (!was || !now || was.points.length !== now.points.length || ed.state.drawing !== null) ed.selection = null;
  };

  /**
   * The insert markers on `shapes`' selected shape, its reflection's included: one at the middle (t = 0.5) of each
   * edge long enough on screen, measured along the curve.
   */
  const markers = (shapes: readonly Shape[]): Marker[] => {
    const shape = ed.state.drawing === null && ed.selection && shapes.find((s) => s.id === ed.selection?.shape);
    if (!shape) return [];
    return ed.asDrawn(shape).flatMap(({ shape: drawn, pointsAsDrawn }) =>
      edgesOf(drawn).flatMap((e): Marker[] => {
        if (polylineLength(edgePolyline(e, CURVE_PIECES)) * ed.view.scale < MARKER_MIN_EDGE_PX) return [];
        const [u, v] = [pointsAsDrawn[e.after], pointsAsDrawn[(e.after + 1) % pointsAsDrawn.length]];
        // A point and its own reflection: a symmetric shape's join across the axis, at its half's start or end.
        const insert =
          u.index === v.index
            ? { join: u.reflected ? ("start" as const) : ("end" as const) }
            : { after: Math.abs(u.index - v.index) === 1 ? Math.min(u.index, v.index) : Math.max(u.index, v.index) };
        if (u.index === v.index && u.reflected === v.reflected) return [];
        return [{ shape, at: edgeAt(e, 0.5), reflected: u.reflected || v.reflected, insert }];
      }),
    );
  };

  /**
   * The handles showing on `shapes` for the selected point, where it's drawn (on the reflection, if that's where it
   * was picked): its own, a stub on each side of a corner without one (pointing along that edge), and its
   * neighbours' on its two edges. None while drawing or with a shape selected, nor on a symmetric shape's straight
   * join across the axis.
   */
  const knobs = (shapes: readonly Shape[]): Knob[] => {
    const picked = ed.state.drawing === null && ed.selection?.kind === "point" ? ed.selection : null;
    const shape = picked && shapes.find((s) => s.id === picked.shape);
    const found = picked && shape?.points[picked.index] && ed.findAsDrawn(shape, picked.index, !!picked.reflected);
    if (!picked || !shape || !found) return [];
    const { shapeAsDrawn, o, k, at: p } = found;
    const { pointsAsDrawn, shape: drawn } = shapeAsDrawn;
    const acting = handlesOf(drawn);
    const out: Knob[] = [];
    const tipOf = (at: XY, h: XY) => ({ x: at.x + h.x, y: at.y + h.y });
    const knob = (j: number, side: Side, tip: XY, stub: boolean, role: Knob["role"]) => {
      const source = pointsAsDrawn[j][side];
      if (source) out.push({ shape, o, k: j, pointAsDrawn: pointsAsDrawn[j], side, source, base: drawn.points[j], tip, stub, role });
    };
    for (const side of ["in", "out"] as const) {
      const j = neighbour(drawn, k, side);
      if (j === null) continue;
      const facing = side === "in" ? "out" : "in";
      const own = acting[k][side];
      const q = drawn.points[j];
      if (own) knob(k, side, tipOf(p, own), false, "own");
      else if (shape.points[picked.index].kind === "corner") {
        // Along the edge as it leaves the point: towards the neighbour's handle on it, or the neighbour.
        const toward = acting[j][facing] ? tipOf(q, acting[j][facing]) : q;
        const d = Math.hypot(toward.x - p.x, toward.y - p.y);
        const reach = STUB_PX / ed.view.scale / d;
        if (d > 0) knob(k, side, { x: p.x + (toward.x - p.x) * reach, y: p.y + (toward.y - p.y) * reach }, true, "own");
      }
      const theirs = acting[j][facing];
      if (theirs) knob(j, facing, tipOf(q, theirs), false, "neighbour");
    }
    return out;
  };

  /**
   * What's under screen point `at`: the nearest point or handle within the hit radius (the shape being drawn
   * winning ties among points), else the nearest insert marker within it, else the nearest shape's edge within it, else
   * the smallest closed shape it's inside. Reflections count as their shapes.
   */
  const hitTest = (at: ScreenPoint): Hit | null => pointOrHandleAt(at) ?? markerAt(at) ?? shapeEdgeAt(at) ?? insideAt(at);
  const pointOrHandleAt = (at: ScreenPoint): Hit | null => {
    const point = pointAt(at);
    let best: Hit | null = null;
    let bestDistance = point ? point.distance : HIT_RADIUS_PX;
    for (const knob of knobs(ed.state.shapes)) {
      const s = toScreen(ed.view, knob.tip);
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bestDistance) [best, bestDistance] = [{ kind: "handle", knob }, d];
    }
    return best ?? point?.hit ?? null;
  };
  const markerAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const marker of markers(ed.state.shapes)) {
      const s = toScreen(ed.view, marker.at);
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bestDistance) [best, bestDistance] = [{ kind: "marker", marker }, d];
    }
    return best;
  };
  const pointAt = (at: ScreenPoint): { hit: Hit & { kind: "point" }; distance: number } | null => {
    let best: { hit: Hit & { kind: "point" }; distance: number } | null = null;
    const order = [...ed.state.shapes].sort((a, b) => Number(b.id === ed.state.drawing) - Number(a.id === ed.state.drawing));
    for (const shape of order) {
      for (const { shape: drawn, pointsAsDrawn } of ed.asDrawn(shape)) {
        pointsAsDrawn.forEach(({ index, reflected }, k) => {
          const s = toScreen(ed.view, drawn.points[k]);
          const d = Math.hypot(s.x - at.x, s.y - at.y);
          if (d < (best?.distance ?? HIT_RADIUS_PX)) best = { hit: { kind: "point", shape, index, reflected }, distance: d };
        });
      }
    }
    return best;
  };
  /** Along the curves, as drawn. */
  const shapeEdgeAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const shape of ed.state.shapes) {
      for (const { shape: drawn, reflected } of ed.asDrawn(shape)) {
        for (const e of edgesOf(drawn)) {
          const pts = edgePolyline(e, CURVE_PIECES).map((p) => toScreen(ed.view, p));
          for (let k = 1; k < pts.length; k++) {
            const d = distanceToSegment(at, pts[k - 1], pts[k]);
            if (d < bestDistance) [best, bestDistance] = [{ kind: "shape", shape, reflected }, d];
          }
        }
      }
    }
    return best;
  };
  const insideAt = (at: ScreenPoint): Hit | null => {
    const p = toDesignSpace(ed.view, at);
    const polygon = (s: Shape) => edgesOf(s).flatMap((e: Edge) => edgePolyline(e, CURVE_PIECES).slice(1));
    const around = ed.state.shapes
      .filter((s) => s.closed)
      .flatMap((s) => ed.asDrawn(s).map(({ shape: drawn, reflected }) => ({ s, reflected, poly: polygon(drawn) })))
      .filter(({ poly }) => insidePolygon(p, poly));
    const smallest = around.sort((a, b) => Math.abs(signedArea(a.poly)) - Math.abs(signedArea(b.poly)))[0];
    return smallest ? { kind: "shape", shape: smallest.s, reflected: smallest.reflected } : null;
  };

  /** What a tap at `at` would do, by what's under it and whether a shape is being drawn. */
  const tapAction = (at: ScreenPoint): TapAction => {
    const hit = hitTest(at);
    const shape = ed.drawingShape();
    if (hit?.kind === "point") {
      const picked = { kind: "point" as const, shape: hit.shape.id, index: hit.index, ...copy(hit.reflected) };
      const selects: TapAction = { do: "select", hit, selection: picked };
      if (!shape || hit.shape.id !== shape.id) return selects;
      if (hit.index === shape.points.length - 1) return { do: "end", hit };
      if (hit.index === 0) return shape.points.length >= 3 ? { do: "close", hit } : { do: "nothing" };
      return { do: "place" };
    }
    if (shape) return { do: "place" };
    if (hit?.kind === "handle") {
      const { knob } = hit;
      const handle = knob.stub ? {} : { handle: knob.side };
      const { index, reflected } = knob.pointAsDrawn;
      return { do: "select", hit, selection: { kind: "point", shape: knob.shape.id, index, ...copy(reflected), ...handle } };
    }
    if (hit?.kind === "marker") return { do: "insert", hit };
    if (hit) return { do: "select", hit, selection: { kind: "shape", shape: hit.shape.id, ...copy(hit.reflected) } };
    return ed.selection ? { do: "deselect" } : { do: "place" };
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

  /**
   * `marker`'s shape with a corner point added at the marker (keeping its edge where it was, and its side of the axis), the
   * new point's index, and whether it's drawn under the marker on the reflection. On a symmetric shape's join across
   * the axis, it's a new end on the axis, and the old end, now between, keeps the straight join as a corner.
   */
  const insert = ({ shape, insert: how, at, reflected }: Marker): { shape: Shape; index: number; reflected: boolean } => {
    if ("join" in how) {
      const last = shape.points.length - 1;
      const [i, own] = how.join === "end" ? [last, "in" as const] : [0, "out" as const];
      const h = actingHandle(shape, ed.axis, i, own);
      const between: Point = { x: shape.points[i].x, y: shape.points[i].y, kind: "corner", ...(h && { [own]: h }) };
      const end: Point = { x: ed.axis, y: at.y, kind: "corner" };
      const rest = how.join === "end" ? shape.points.slice(0, last) : shape.points.slice(1);
      const points = how.join === "end" ? [...rest, between, end] : [end, between, ...rest];
      return { shape: { ...shape, points }, index: how.join === "end" ? last + 1 : 0, reflected: false };
    }
    let index = 0;
    const next = editMirrored(shape, ed.axis, [how.after, how.after + 1], (plain) => {
      const done = split(plain, how.after);
      index = done.index;
      return done.shape;
    });
    const p = next.points[index];
    const x = keep(p, next, index).x;
    const points = next.points.map((q, i) => (i === index ? { ...q, x } : q));
    return { shape: { ...next, points }, index, reflected: reflected && !onAxis({ x, y: p.y }, ed.axis) };
  };

  /** A tap, kept so that a double-tap straight after it can take it back. */
  const firstTap = (at: ScreenPoint) => {
    const before: Before = { state: ed.state, undo: [...undoStack], redo: [...redoStack], selection: ed.selection, nextId: ed.nextId };
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
    [ed.selection, ed.nextId, redoStack] = [before.selection, before.nextId, [...before.redo]];
    undoStack.splice(0, undoStack.length, ...before.undo);
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

  const toggleSymmetry = () => {
    ed.symmetry = !ed.symmetry;
  };

  /** `shape` with its point `index` switched between smooth and corner. */
  const toggled = (shape: Shape, index: number) => editMirrored(shape, ed.axis, [index], (s) => toggleKind(s, index));

  /** Smooth / Corner on the selected point. */
  const toggleSelected = () => {
    const picked = ed.selection?.kind === "point" ? ed.selection : null;
    const shape = picked && ed.state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    change({ ...ed.state, shapes: ed.replace(toggled(shape, picked.index)) });
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
   * `shape` with the handle on `side` of its point as drawn `knob` set to design-space `offset` as drawn, or (null)
   * removed (as it is within `RETRACT_PX` of its point, when it `retracts`): the shape's own handle, mirrored back
   * when it's drawn on a reflection (a smooth end on the axis then levels it, as every edit does).
   */
  const withKnob = (knob: Knob, offset: XY, alone: boolean, retracts = true): Shape => {
    const { shape, pointAsDrawn, source } = knob;
    const own = source.mirrored ? mirrorOffset(offset) : offset;
    const short = Math.hypot(own.x, own.y) * ed.view.scale < (retracts ? RETRACT_PX : 1e-9);
    const kept = short ? null : own;
    return editMirrored(shape, ed.axis, [pointAsDrawn.index], (s) => withHandle(s, pointAsDrawn.index, source.side, kept, alone));
  };

  /** The handle on `side` of point `k` of `shape` as drawn `o`, as it acts now. */
  const handleAt = (shape: Shape, o: number, k: number, side: Side) => {
    const shapeAsDrawn = ed.asDrawn(shape)[o];
    return shapeAsDrawn && handlesOf(shapeAsDrawn.shape)[k]?.[side];
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

  /**
   * `start` with its point `index` moved by design-space `delta` (or, with `index` null, the whole shape), kept on
   * the page and to its side of the axis; a mirrored shape's point snaps onto the axis (`held`: it was snapped).
   * A delta from a drag on the reflection is mirrored first, so the reflection follows the finger.
   */
  const movedBy = (start: Shape, index: number | null, delta: XY, reflected: boolean, held: boolean) => {
    const by = reflected ? mirrorOffset(delta) : delta;
    if (index === null) return { shape: moveWhole(start, by, ed.page, ed.axis), snapped: false };
    const p = start.points[index];
    const c = constrain({ x: p.x + by.x, y: p.y + by.y }, start, start.mirror !== "none", index, held);
    const points = start.points.map((q, i) => (i === index ? { ...q, x: c.x, y: c.y } : q));
    return { shape: { ...start, points }, snapped: c.snapped };
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


  const undo = () => {
    endReframing();
    const prev = ed.finished ? undefined : undoStack.pop();
    if (!prev) return;
    ed.drag = null;
    const from = ed.state;
    redoStack.push(ed.state);
    ed.setState(prev);
    settle(from);
  };
  const redo = () => {
    endReframing();
    const next = ed.finished ? undefined : redoStack.pop();
    if (!next) return;
    ed.drag = null;
    const from = ed.state;
    undoStack.push(ed.state);
    ed.setState(next);
    settle(from);
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

  /**
   * Nudge the selected handle, point or shape `by` screen px, the way the arrow points where it's drawn (on a
   * reflection too); a run of nudges is one undo step.
   */
  const nudge = (by: { x: number; y: number }): boolean => {
    const picked = ed.selection;
    const shape = picked && ed.state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return false;
    const delta = { x: by.x / ed.view.scale, y: -by.y / ed.view.scale };
    const reflected = !!picked.reflected;
    let next: Shape;
    const handle = picked.kind === "point" ? picked.handle : undefined;
    const knob = handle && knobs(ed.state.shapes).find((h) => h.role === "own" && !h.stub && h.side === handle);
    if (knob) {
      const offset = { x: knob.tip.x - knob.base.x + delta.x, y: knob.tip.y - knob.base.y + delta.y };
      next = withKnob(knob, offset, false, false);
    } else if (picked.kind === "point") {
      const p = shape.points[picked.index];
      const by = reflected ? mirrorOffset(delta) : delta;
      const q = keep({ x: p.x + by.x, y: p.y + by.y }, shape, picked.index);
      next = { ...shape, points: shape.points.map((r, i) => (i === picked.index ? { ...r, ...q } : r)) };
    } else next = moveWhole(shape, reflected ? mirrorOffset(delta) : delta, ed.page, ed.axis);
    const same = JSON.stringify(next) === JSON.stringify(shape);
    if (same) return true;
    const after = { ...ed.state, shapes: ed.replace(next) };
    if (nudged?.state === ed.state && nudged.selection === picked) ed.state = after;
    else change(after);
    nudged = { state: ed.state, selection: picked };
    return true;
  };

  /** Escape: cancel the drag under way, putting back what it moved (or the view a pan moved). */
  const cancelDrag = () => {
    if (ed.drag?.kind === "move" || ed.drag?.kind === "handle") ed.selection = ed.drag.selection;
    if (ed.drag?.kind === "pan") ed.view = ed.drag.from;
    ed.drag = null;
  };

  /** Backspace while drawing with nothing selected: take off the last point placed, and the shape with its only one. */
  const removeLast = () => {
    const shape = ed.drawingShape()!;
    const points = shape.points.slice(0, -1);
    if (points.length > 0) change({ ...ed.state, shapes: ed.replace({ ...shape, points }) });
    else change({ ...ed.state, shapes: ed.state.shapes.filter((s) => s !== shape), drawing: null });
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
      if (lower === "z" && !shift) return can(undoStack.length > 0, undo);
      if ((lower === "z" && shift) || lower === "y") return can(redoStack.length > 0, redo);
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
      can: { undo: undoStack.length > 0, redo: redoStack.length > 0, clear: ed.state.shapes.length > 0 },
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

/**
 * `shape` moved whole by `delta`, kept on `page`: it stops at the page's edge rather than squashing against it (one
 * already over the edge, imported, can still move back). A twin stops at the axis, on its side; a symmetric shape,
 * centred on the axis, moves only up and down.
 */
function moveWhole(shape: Shape, delta: { x: number; y: number }, page: Page, axis: number): Shape {
  const stop = (d: number, values: number[], max: number) =>
    Math.min(Math.max(0, max - Math.max(...values)), Math.max(Math.min(0, -Math.min(...values)), d));
  const xs = shape.points.map((p) => p.x);
  let dx = shape.mirror === "symmetric" ? 0 : stop(delta.x, xs, page.width);
  const side = shape.mirror === "twin" ? sideOf(shape, axis) : 0;
  if (side > 0) dx = Math.max(dx, Math.min(0, axis - Math.min(...xs)));
  if (side < 0) dx = Math.min(dx, Math.max(0, axis - Math.max(...xs)));
  const dy = stop(delta.y, shape.points.map((p) => p.y), page.height);
  return { ...shape, points: shape.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}
