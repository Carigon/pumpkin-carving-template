import { distanceToSegment, insidePolygon, signedArea, type BBox, type Design, type TemplateWarning } from "../core";
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
  outlinesOf,
  sideOf,
  type Outline,
  type OutlineNode,
} from "./symmetry";
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

/** One shape as drawn: its outline as screen path data, dashed while open. */
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
  /** Every closed shape's outline in one path, filled even-odd: what's carved. */
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

/**
 * The loupe: a circle `box` wide, clear of the finger, showing the canvas as drawn magnified `magnification` times
 * about `focus`, where the point under the finger will land (its crosshair).
 */
export interface Loupe {
  box: ScreenRect;
  focus: ScreenPoint;
  magnification: number;
}

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
  shapePaths(map: (p: XY) => XY): { closed: string; open: string };
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

/** Screen radius (px) within which a tap hits a point or an outline, whatever the zoom; the axis snap's too. */
const HIT_RADIUS_PX = 22;
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
/** The loupe's width across (px), and how many times it magnifies the canvas as drawn (so over the current zoom). */
const LOUPE_PX = 130;
const LOUPE_MAGNIFICATION = 3;
/** The gap (px) between the finger and the loupe, about a fingertip, so the finger never hides it. */
const LOUPE_GAP_PX = 56;
/** The loupe stays this far (px) inside the canvas's edges. */
const LOUPE_MARGIN_PX = 4;
/** How much + and − zoom, as the Blueprint view's zoom buttons do. */
const KEY_ZOOM_STEP = 1.25;
/** How far an arrow key nudges, in screen px, and with Shift. */
const NUDGE_PX = 1;
const SHIFT_NUDGE_PX = 10;
/** Each arrow key's direction on screen (y down). */
const ARROWS = new Map([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
]);
/** The pill's hint when nothing is being drawn. */
const HINT = "Tap to place a point.";

/** The shapes, which one is being drawn, and the page and cleanup they're over: what an undo step puts back. */
interface State {
  shapes: readonly Shape[];
  drawing: number | null;
  page: Page;
  /** The cleanup under a photo, as the app keeps it; null without one. */
  cleanup: unknown;
}

/**
 * What's under a tap or the start of a drag: a point (its shape and index), a handle or stub, an insert marker, or a
 * shape by its outline or inside. `reflected` when it's a mirrored shape's reflection that's under it.
 */
type Hit =
  | { kind: "point"; shape: Shape; index: number; reflected: boolean }
  | { kind: "handle"; knob: Knob }
  | { kind: "marker"; marker: Marker }
  | { kind: "shape"; shape: Shape; reflected: boolean };

/**
 * A handle or stub showing for the selected point, in design space: on `side` of `node` (the `k`th of the shape's
 * outline `o` as drawn), from `base` to `tip`; `source` says which of the shape's handles that is, and whether the
 * drawing mirrors it. `role` is the selected point's own, or a neighbour's on one of its edges.
 */
interface Knob {
  shape: Shape;
  o: number;
  k: number;
  node: OutlineNode;
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
 * What's selected: one point (by its shape and index, as placed or `reflected`), with one of its handles as drawn
 * (`handle`, for the arrow keys) or not, or one shape (touched on its reflection or not). Selecting isn't an undo
 * step.
 */
type Selection =
  | { kind: "point"; shape: number; index: number; reflected?: true; handle?: Side }
  | { kind: "shape"; shape: number; reflected?: true };

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

/**
 * A drag or hold under way: a pan from the view it started at; a move of one point (`index`) or of a whole shape
 * (`index` null), by its reflection or not; a handle or stub dragged (`alone` with Alt held); aiming the loupe at
 * where a point will be placed, the finger `at`; or a hold that's waiting to be a tap or a drag. A move or handle
 * drag is shown as `live` and kept out of the shapes until it ends, as one undo step; `selection` is what was
 * selected before, put back if the drag is cancelled; `loupe` says it's by touch. `snapped` while the point is held
 * on the axis.
 */
type Drag =
  | { kind: "pan"; from: ViewTransform }
  | {
      kind: "move";
      shape: Shape;
      index: number | null;
      reflected: boolean;
      snapped: boolean;
      live: readonly Shape[] | null;
      selection: Selection | null;
      at: ScreenPoint;
      loupe: boolean;
    }
  | {
      kind: "handle";
      knob: Knob;
      /** From the finger to the handle's tip, on screen: the tip keeps its place under the finger. */
      grab: ScreenPoint;
      alone: boolean;
      live: readonly Shape[] | null;
      selection: Selection | null;
      at: ScreenPoint;
      loupe: boolean;
    }
  | { kind: "aim"; at: ScreenPoint; snapped: boolean }
  | { kind: "held" };

/** Everything a tap may change, kept so a double-tap can take the tap back. */
interface Before {
  state: State;
  undo: State[];
  redo: State[];
  selection: Selection | null;
  nextId: number;
}

/** A blank page: square, with points relative to its size. */
const BLANK_PAGE: Page = { width: 1, height: 1 };

export function createHandTrace<C = unknown>(options: HandTraceOptions<C>): HandTrace<C> {
  const cleanups = options.cleanup;
  const reopened = options.record;
  let state: State = {
    shapes: reopened?.shapes ?? [],
    drawing: reopened?.drawing ?? null,
    page: cleanups ? cleanups.page(cleanups.start) : (options.page ?? BLANK_PAGE),
    cleanup: cleanups ? cleanups.start : null,
  };
  /** The page the points are placed on now: the state's. */
  let page = state.page;
  /** The symmetry axis: a vertical line down the page's middle, as its x. */
  let axis = page.width / 2;
  /**
   * A run of live cleanup changes under way: the state before it, which every change in the run is carried from and
   * which the `Design` and the record still show; null with none.
   */
  let reframing: { from: State } | null = null;
  const undoStack: State[] = [];
  let redoStack: State[] = [];
  let nextId = Math.max(0, ...state.shapes.map((s) => s.id)) + 1;
  let selection: Selection | null = null;
  let finished = reopened?.done ?? false;
  /** The Symmetry setting: shapes started while it's on are mirrored. */
  let symmetry = reopened?.symmetry ?? false;
  /** The record last handed out, and what it was made from. */
  let recordOf: { state: State; finished: boolean; symmetry: boolean; record: HandTraceRecord } | null = null;
  let size = { width: 0, height: 0 };
  let view: ViewTransform = fitView(page, 1, 1);
  /** The carver has panned or zoomed, so a resize keeps the view. */
  let moved = false;
  let drag: Drag | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;
  /** The warnings last shown, and the Design they were for: once that changes, they're out of date. */
  let warnings: { design: Design | null; warnings: readonly TemplateWarning[] } | null = null;
  /** Where a mouse or pen hovers, and whether a press there pans (Space held); null once it has left. */
  let pointer: { at: ScreenPoint; pans: boolean } | null = null;
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
  const committed = () => reframing?.from ?? state;
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

  /** Each shape's outlines as drawn, worked out once per shape and axis: shapes are never changed in place. */
  const outlineCache = new WeakMap<Shape, { axis: number; outlines: Outline[] }>();
  const outlines = (shape: Shape): Outline[] => {
    const known = outlineCache.get(shape);
    if (known?.axis === axis) return known.outlines;
    const made = outlinesOf(shape, axis);
    outlineCache.set(shape, { axis, outlines: made });
    return made;
  };

  /** Put `next` in place: a new page brings its own axis, and refits the view unless the carver has moved it. */
  const setState = (next: State) => {
    state = next;
    if (next.page === page) return;
    page = next.page;
    axis = page.width / 2;
    if (!moved && size.width > 0 && size.height > 0) view = fitView(page, size.width, size.height);
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
    drag = null;
    if (live) {
      reframing = { from };
      return setState(next);
    }
    reframing = null;
    setState(from);
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
  /**
   * Where `shape`'s point `index` is drawn, as placed or `reflected`: its outline (`o`), node and place there (`k`)
   * and position. A symmetric shape's end on the axis is one node, whichever copy is asked for.
   */
  const nodeOf = (shape: Shape, index: number, reflected: boolean) => {
    const all = outlines(shape).flatMap((outline, o) =>
      outline.nodes.map((node, k) => ({ outline, o, k, node, at: outline.shape.points[k] })),
    );
    const exact = all.find((n) => n.node.index === index && n.node.reflected === reflected);
    return exact ?? all.find((n) => n.node.index === index) ?? null;
  };

  const drawingShape = () => state.shapes.find((s) => s.id === state.drawing) ?? null;

  /** Make a change to the shapes, as one undo step. A move under way is dropped: it was built on the old shapes. */
  const change = (next: State) => {
    endReframing();
    drag = null;
    undoStack.push(state);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    setState(next);
  };
  const replace = (shape: Shape): readonly Shape[] => state.shapes.map((s) => (s.id === shape.id ? shape : s));

  /**
   * Design-space position `p` clamped to the page, and for a point of mirrored `shape` (its point `skip` the one
   * moving) kept to the shape's side of the axis.
   */
  const keep = (p: XY, shape: Shape | null, skip = -1): XY => {
    const x = Math.min(page.width, Math.max(0, p.x));
    const y = Math.min(page.height, Math.max(0, p.y));
    return { x: shape && shape.mirror !== "none" ? keptToSide(x, sideOf(shape, axis, skip), axis) : x, y };
  };
  /**
   * `p` kept (as `keep` does) and, for a point of a mirrored shape being drawn or dragged, snapped onto the axis
   * within the hit radius, or the wider release distance while `held` there already. `snapped` once it's on the axis.
   */
  const constrain = (p: XY, shape: Shape | null, mirrored: boolean, skip = -1, held = false) => {
    const x = Math.min(page.width, Math.max(0, p.x));
    const near = mirrored && Math.abs(x - axis) * view.scale < HIT_RADIUS_PX * (held ? SNAP_RELEASE : 1);
    const q = keep({ x: near ? axis : x, y: p.y }, mirrored ? shape : null, skip);
    return { ...q, snapped: mirrored && q.x === axis };
  };

  /** Whether a point placed now is a mirrored shape's: the shape being drawn's, or (with none) a new one's. */
  const placingMirrored = () => {
    const shape = drawingShape();
    return shape ? shape.mirror !== "none" : symmetry;
  };

  /** A screen position as a point placed on the page: clamped to it; for a mirrored shape, snapped and kept to its side. */
  const placeAt = (at: ScreenPoint, held = false): { point: Point; snapped: boolean } => {
    const { x, y, snapped } = constrain(toDesignSpace(view, at), drawingShape(), placingMirrored(), -1, held);
    return { point: { x, y, kind: "corner" }, snapped };
  };

  /**
   * Place a point (`held` on the axis already, as a hold aims): on the shape being drawn, or starting one. A mirrored
   * shape started on the axis closes by itself as it lands on the axis again, with points off it to mirror.
   */
  const place = (at: ScreenPoint, held = false) => {
    const { point } = placeAt(at, held);
    const shape = drawingShape();
    if (shape) {
      const grown = { ...shape, points: [...shape.points, point] };
      const on = (p: XY) => onAxis(p, axis);
      const lands = shape.mirror !== "none" && on(point) && on(shape.points[0]) && grown.points.length >= 3;
      if (lands && !grown.points.every(on)) change({ ...state, shapes: replace(closed(grown, axis)), drawing: null });
      else change({ ...state, shapes: replace(grown) });
    } else {
      const id = nextId++;
      const mirror = symmetry ? "twin" : "none";
      change({ ...state, shapes: [...state.shapes, { id, closed: false, mirror, points: [point] }], drawing: id });
    }
  };

  const close = () => {
    const shape = drawingShape();
    if (!shape || shape.points.length < 3) return;
    change({ ...state, shapes: replace(closed(shape, axis)), drawing: null });
  };
  const end = () => {
    if (state.drawing !== null) state = { ...state, drawing: null };
  };

  /** The selected point's shape, if the point is one of an open shape's two ends. */
  const openEnd = (): Shape | null => {
    if (selection?.kind !== "point") return null;
    const { shape: id, index } = selection;
    const shape = state.shapes.find((s) => s.id === id);
    return shape && !shape.closed && (index === 0 || index === shape.points.length - 1) ? shape : null;
  };
  const carryOn = () => {
    const shape = openEnd();
    if (!shape) return;
    // Drawing always adds at the last point, so carrying on from the first turns the shape round.
    const turned = selection?.kind === "point" && selection.index === 0 && shape.points.length > 1;
    const shapes = turned ? replace({ ...shape, points: [...shape.points].reverse() }) : state.shapes;
    state = { ...state, shapes, drawing: shape.id };
    selection = null;
    drag = null;
  };

  /**
   * Whether closed `shape` is too small to keep: under 3 points, or for a symmetric shape, counted whole, under 3
   * distinct points or enclosing no area.
   */
  const tooSmall = (shape: Shape): boolean => {
    if (shape.mirror !== "symmetric") return shape.points.length < 3;
    const [whole] = outlines(shape);
    const poly = edgesOf(whole.shape).flatMap((e) => edgePolyline(e, CURVE_PIECES).slice(1));
    return whole.nodes.length < 3 || Math.abs(signedArea(poly)) <= NO_AREA * page.width * page.height;
  };

  /** Delete the selected point (its source, if it's on a reflection) or shape, and a shape the point leaves too small. */
  const remove = () => {
    const picked = selection;
    const shape = picked && state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    const i = picked.kind === "point" ? picked.index : -1;
    const left = i >= 0 ? editMirrored(shape, axis, [i - 1, i, i + 1], (s) => withoutPoint(s, i)) : { ...shape, points: [] };
    const gone = left.points.length === 0 || (shape.closed && tooSmall(left));
    const shapes = gone ? state.shapes.filter((s) => s !== shape) : replace(left);
    change({ ...state, shapes });
    selection = null;
  };

  /**
   * After an undo or redo from `from`: keep the selection while its shape is still there with as many points, so
   * a point index still means the same point, and nothing is being drawn.
   */
  const settle = (from: State) => {
    const find = (shapes: readonly Shape[]) => selection && shapes.find((s) => s.id === selection?.shape);
    const [was, now] = [find(from.shapes), find(state.shapes)];
    if (!was || !now || was.points.length !== now.points.length || state.drawing !== null) selection = null;
  };

  /**
   * The insert markers on `shapes`' selected shape, its reflection's included: one at the middle (t = 0.5) of each
   * edge long enough on screen, measured along the curve.
   */
  const markers = (shapes: readonly Shape[]): Marker[] => {
    const shape = state.drawing === null && selection && shapes.find((s) => s.id === selection?.shape);
    if (!shape) return [];
    return outlines(shape).flatMap(({ shape: drawn, nodes }) =>
      edgesOf(drawn).flatMap((e): Marker[] => {
        if (polylineLength(edgePolyline(e, CURVE_PIECES)) * view.scale < MARKER_MIN_EDGE_PX) return [];
        const [u, v] = [nodes[e.after], nodes[(e.after + 1) % nodes.length]];
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
    const picked = state.drawing === null && selection?.kind === "point" ? selection : null;
    const shape = picked && shapes.find((s) => s.id === picked.shape);
    const found = picked && shape?.points[picked.index] && nodeOf(shape, picked.index, !!picked.reflected);
    if (!picked || !shape || !found) return [];
    const { outline, o, k, at: p } = found;
    const { nodes, shape: drawn } = outline;
    const acting = handlesOf(drawn);
    const out: Knob[] = [];
    const tipOf = (at: XY, h: XY) => ({ x: at.x + h.x, y: at.y + h.y });
    const knob = (j: number, side: Side, tip: XY, stub: boolean, role: Knob["role"]) => {
      const source = nodes[j][side];
      if (source) out.push({ shape, o, k: j, node: nodes[j], side, source, base: drawn.points[j], tip, stub, role });
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
        const reach = STUB_PX / view.scale / d;
        if (d > 0) knob(k, side, { x: p.x + (toward.x - p.x) * reach, y: p.y + (toward.y - p.y) * reach }, true, "own");
      }
      const theirs = acting[j][facing];
      if (theirs) knob(j, facing, tipOf(q, theirs), false, "neighbour");
    }
    return out;
  };

  /**
   * What's under screen point `at`: the nearest point or handle within the hit radius (the shape being drawn
   * winning ties among points), else the nearest insert marker within it, else the nearest outline within it, else
   * the smallest closed shape it's inside. Reflections count as their shapes.
   */
  const hitTest = (at: ScreenPoint): Hit | null => pointOrHandleAt(at) ?? markerAt(at) ?? outlineAt(at) ?? insideAt(at);
  const pointOrHandleAt = (at: ScreenPoint): Hit | null => {
    const point = pointAt(at);
    let best: Hit | null = null;
    let bestDistance = point ? point.distance : HIT_RADIUS_PX;
    for (const knob of knobs(state.shapes)) {
      const s = toScreen(view, knob.tip);
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bestDistance) [best, bestDistance] = [{ kind: "handle", knob }, d];
    }
    return best ?? point?.hit ?? null;
  };
  const markerAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const marker of markers(state.shapes)) {
      const s = toScreen(view, marker.at);
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bestDistance) [best, bestDistance] = [{ kind: "marker", marker }, d];
    }
    return best;
  };
  const pointAt = (at: ScreenPoint): { hit: Hit & { kind: "point" }; distance: number } | null => {
    let best: { hit: Hit & { kind: "point" }; distance: number } | null = null;
    const order = [...state.shapes].sort((a, b) => Number(b.id === state.drawing) - Number(a.id === state.drawing));
    for (const shape of order) {
      for (const { shape: drawn, nodes } of outlines(shape)) {
        nodes.forEach(({ index, reflected }, k) => {
          const s = toScreen(view, drawn.points[k]);
          const d = Math.hypot(s.x - at.x, s.y - at.y);
          if (d < (best?.distance ?? HIT_RADIUS_PX)) best = { hit: { kind: "point", shape, index, reflected }, distance: d };
        });
      }
    }
    return best;
  };
  /** Along the curves, as drawn. */
  const outlineAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const shape of state.shapes) {
      for (const { shape: drawn, reflected } of outlines(shape)) {
        for (const e of edgesOf(drawn)) {
          const pts = edgePolyline(e, CURVE_PIECES).map((p) => toScreen(view, p));
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
    const p = toDesignSpace(view, at);
    const polygon = (s: Shape) => edgesOf(s).flatMap((e: Edge) => edgePolyline(e, CURVE_PIECES).slice(1));
    const around = state.shapes
      .filter((s) => s.closed)
      .flatMap((s) => outlines(s).map(({ shape: drawn, reflected }) => ({ s, reflected, poly: polygon(drawn) })))
      .filter(({ poly }) => insidePolygon(p, poly));
    const smallest = around.sort((a, b) => Math.abs(signedArea(a.poly)) - Math.abs(signedArea(b.poly)))[0];
    return smallest ? { kind: "shape", shape: smallest.s, reflected: smallest.reflected } : null;
  };

  /** `{ reflected: true }` for a reflection, nothing otherwise: how a selection says which copy was picked. */
  const copy = (reflected: boolean) => (reflected ? { reflected: true as const } : {});

  /** What a tap at `at` would do, by what's under it and whether a shape is being drawn. */
  const tapAction = (at: ScreenPoint): TapAction => {
    const hit = hitTest(at);
    const shape = drawingShape();
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
      const { index, reflected } = knob.node;
      return { do: "select", hit, selection: { kind: "point", shape: knob.shape.id, index, ...copy(reflected), ...handle } };
    }
    if (hit?.kind === "marker") return { do: "insert", hit };
    if (hit) return { do: "select", hit, selection: { kind: "shape", shape: hit.shape.id, ...copy(hit.reflected) } };
    return selection ? { do: "deselect" } : { do: "place" };
  };
  const tap = (at: ScreenPoint) => {
    const action = tapAction(at);
    if (action.do === "place") place(at);
    else if (action.do === "close") close();
    else if (action.do === "end") end();
    else if (action.do === "select") {
      end();
      selection = action.selection;
    } else if (action.do === "insert") {
      const { shape, index, reflected } = insert(action.hit.marker);
      change({ ...state, shapes: replace(shape) });
      selection = { kind: "point", shape: shape.id, index, ...copy(reflected) };
    } else if (action.do === "deselect") selection = null;
  };

  /** Where the mouse or pen hovers: what a click there would act on, the cursor, and the rubber band. */
  const hovering = (): Pick<Drawn, "hover" | "cursor" | "rubberBand"> => {
    const none = { hover: null, rubberBand: null };
    if (finished || !pointer) return { ...none, cursor: "default" };
    if (drag) return { ...none, cursor: "grabbing" };
    if (pointer.pans) return { ...none, cursor: "grab" };
    const action = tapAction(pointer.at);
    const last = drawingShape()?.points.at(-1);
    const band = (to: { x: number; y: number }) => (last ? { from: toScreen(view, last), to: toScreen(view, to) } : null);
    if (action.do === "place") return { hover: null, cursor: "crosshair", rubberBand: band(placeAt(pointer.at).point) };
    if (action.do === "deselect" || action.do === "nothing") return { ...none, cursor: "default" };
    const { hit } = action;
    if (hit.kind === "shape") {
      const picked = selection?.kind === "shape" && selection.shape === hit.shape.id;
      return { hover: { kind: "shape", id: hit.shape.id }, cursor: picked ? "move" : "pointer", rubberBand: null };
    }
    if (hit.kind === "handle") {
      return { hover: { kind: "handle", at: toScreen(view, hit.knob.tip) }, cursor: "move", rubberBand: null };
    }
    const at = hit.kind === "point" ? nodeOf(hit.shape, hit.index, hit.reflected)!.at : hit.marker.at;
    const rubberBand = action.do === "close" ? band(at) : null;
    return { hover: { kind: hit.kind, at: toScreen(view, at) }, cursor: "pointer", rubberBand };
  };

  /**
   * `marker`'s shape with a corner point added at the marker (keeping the outline, and its side of the axis), the
   * new point's index, and whether it's drawn under the marker on the reflection. On a symmetric shape's join across
   * the axis, it's a new end on the axis, and the old end, now between, keeps the straight join as a corner.
   */
  const insert = ({ shape, insert: how, at, reflected }: Marker): { shape: Shape; index: number; reflected: boolean } => {
    if ("join" in how) {
      const last = shape.points.length - 1;
      const [i, own] = how.join === "end" ? [last, "in" as const] : [0, "out" as const];
      const h = actingHandle(shape, axis, i, own);
      const between: Point = { x: shape.points[i].x, y: shape.points[i].y, kind: "corner", ...(h && { [own]: h }) };
      const end: Point = { x: axis, y: at.y, kind: "corner" };
      const rest = how.join === "end" ? shape.points.slice(0, last) : shape.points.slice(1);
      const points = how.join === "end" ? [...rest, between, end] : [end, between, ...rest];
      return { shape: { ...shape, points }, index: how.join === "end" ? last + 1 : 0, reflected: false };
    }
    let index = 0;
    const next = editMirrored(shape, axis, [how.after, how.after + 1], (plain) => {
      const done = split(plain, how.after);
      index = done.index;
      return done.shape;
    });
    const p = next.points[index];
    const x = keep(p, next, index).x;
    const points = next.points.map((q, i) => (i === index ? { ...q, x } : q));
    return { shape: { ...next, points }, index, reflected: reflected && !onAxis({ x, y: p.y }, axis) };
  };

  /** A tap, kept so that a double-tap straight after it can take it back. */
  const firstTap = (at: ScreenPoint) => {
    const before: Before = { state, undo: [...undoStack], redo: [...redoStack], selection, nextId };
    const hit = pointOrHandleAt(at);
    const point = hit?.kind === "point" ? { shape: hit.shape.id, index: hit.index } : null;
    tap(at);
    tapped = { at, before, point, state, selection };
  };

  /**
   * The second tap of a double-tap: on the point the first tap hit, take the first tap back and switch the point
   * between smooth and corner instead, selecting it (or carrying on drawing, on the shape being drawn). Anywhere
   * else, or once something has changed since, it's a plain tap.
   */
  const doubleTap = (at: ScreenPoint) => {
    const first = tapped;
    tapped = null;
    if (!first?.point || first.state !== state || first.selection !== selection) return tap(at);
    const { before } = first;
    setState(before.state);
    [selection, nextId, redoStack] = [before.selection, before.nextId, [...before.redo]];
    undoStack.splice(0, undoStack.length, ...before.undo);
    const hit = pointAt(at)?.hit;
    if (hit?.kind !== "point" || hit.shape.id !== first.point.shape || hit.index !== first.point.index) {
      tap(first.at);
      return tap(at);
    }
    if (hit.shape.id !== state.drawing) {
      end();
      selection = { kind: "point", shape: hit.shape.id, index: hit.index, ...copy(hit.reflected) };
    }
    change({ ...state, shapes: replace(toggled(hit.shape, hit.index)) });
  };

  const toggleSymmetry = () => {
    symmetry = !symmetry;
  };

  /** `shape` with its point `index` switched between smooth and corner. */
  const toggled = (shape: Shape, index: number) => editMirrored(shape, axis, [index], (s) => toggleKind(s, index));

  /** Smooth / Corner on the selected point. */
  const toggleSelected = () => {
    const picked = selection?.kind === "point" ? selection : null;
    const shape = picked && state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    change({ ...state, shapes: replace(toggled(shape, picked.index)) });
  };

  /**
   * What a drag starting at `from` does: move the point under it, add a point at the insert marker under it and
   * move that, move the selected shape, or pan.
   */
  const startDrag = (from: ScreenPoint, pointerType: PointerKind, alone = false): Drag => {
    const hit = hitTest(from);
    const moving = { live: null, selection, at: from, loupe: pointerType === "touch" };
    /** A point starts held on the axis when it's on it, for a mirrored shape. */
    const held = (shape: Shape, index: number) => shape.mirror !== "none" && onAxis(shape.points[index], axis);
    if (hit?.kind === "handle") {
      const { knob } = hit;
      const { index, reflected } = knob.node;
      selection = { kind: "point", shape: knob.shape.id, index, ...copy(reflected), handle: knob.side };
      const tip = toScreen(view, knob.tip);
      return { kind: "handle", knob, grab: { x: tip.x - from.x, y: tip.y - from.y }, alone, ...moving };
    }
    if (hit?.kind === "point") {
      const { shape, index, reflected } = hit;
      if (shape.id !== state.drawing) {
        end();
        selection = { kind: "point", shape: shape.id, index, ...copy(reflected) };
      }
      return { kind: "move", shape, index, reflected, snapped: held(shape, index), ...moving };
    }
    if (hit?.kind === "marker") {
      const { shape, index, reflected } = insert(hit.marker);
      selection = { kind: "point", shape: shape.id, index, ...copy(reflected) };
      return { kind: "move", shape, index, reflected, snapped: held(shape, index), ...moving };
    }
    if (hit && selection?.kind === "shape" && selection.shape === hit.shape.id) {
      const whole = { index: null, reflected: hit.reflected, snapped: false };
      return { kind: "move", shape: hit.shape, ...whole, ...moving, loupe: false };
    }
    return { kind: "pan", from: view };
  };

  /** A pan, from a drag on empty space or from anywhere (Space or the middle button): the page follows the pointer. */
  const panGesture = (g: Pick<PanGesture, "phase" | "from" | "at">) => {
    if (g.phase === "start") drag = { kind: "pan", from: view };
    if (drag?.kind !== "pan") return;
    view = { ...drag.from, tx: drag.from.tx + g.at.x - g.from.x, ty: drag.from.ty + g.at.y - g.from.y };
    moved = true;
    if (g.phase === "end" || g.phase === "cancel") drag = null;
  };

  /**
   * `shape` with the handle on `side` of its outline node `knob` set to design-space `offset` as drawn, or (null)
   * removed (as it is within `RETRACT_PX` of its point, when it `retracts`): the shape's own handle, mirrored back
   * when it's drawn on a reflection (a smooth end on the axis then levels it, as every edit does).
   */
  const withKnob = (knob: Knob, offset: XY, alone: boolean, retracts = true): Shape => {
    const { shape, node, source } = knob;
    const own = source.mirrored ? mirrorOffset(offset) : offset;
    const short = Math.hypot(own.x, own.y) * view.scale < (retracts ? RETRACT_PX : 1e-9);
    const kept = short ? null : own;
    return editMirrored(shape, axis, [node.index], (s) => withHandle(s, node.index, source.side, kept, alone));
  };

  /** The handle on `side` of `shape`'s node `k` in its outline `o`, as it acts now. */
  const handleAt = (shape: Shape, o: number, k: number, side: Side) => {
    const outline = outlines(shape)[o];
    return outline && handlesOf(outline.shape)[k]?.[side];
  };

  /**
   * A handle or stub dragged: its tip follows the finger, kept on the page; within `RETRACT_PX` of its point it's
   * removed. On a reflection, the shape's handle moves the mirrored way, so the tip stays under the finger. Shown
   * live, and one undo step when it ends.
   */
  const handleDrag = (g: DragGesture, d: Drag & { kind: "handle" }) => {
    d.at = g.at;
    if (g.phase === "cancel") {
      selection = d.selection;
      drag = null;
      return;
    }
    const { shape, base, o, k, side, node } = d.knob;
    const tip = toDesignSpace(view, { x: g.at.x + d.grab.x, y: g.at.y + d.grab.y });
    const clamped = { x: Math.min(page.width, Math.max(0, tip.x)), y: Math.min(page.height, Math.max(0, tip.y)) };
    const next = withKnob(d.knob, { x: clamped.x - base.x, y: clamped.y - base.y }, d.alone);
    d.live = replace(next);
    if (g.phase !== "end") return;
    const kept = handleAt(next, o, k, side) ? { handle: side } : {};
    selection = { kind: "point", shape: shape.id, index: node.index, ...copy(node.reflected), ...kept };
    if (JSON.stringify(next) !== JSON.stringify(shape)) change({ ...state, shapes: d.live });
    drag = null;
  };

  /**
   * `start` with its point `index` moved by design-space `delta` (or, with `index` null, the whole shape), kept on
   * the page and to its side of the axis; a mirrored shape's point snaps onto the axis (`held`: it was snapped).
   * A delta from a drag on the reflection is mirrored first, so the reflection follows the finger.
   */
  const movedBy = (start: Shape, index: number | null, delta: XY, reflected: boolean, held: boolean) => {
    const by = reflected ? mirrorOffset(delta) : delta;
    if (index === null) return { shape: moveWhole(start, by, page, axis), snapped: false };
    const p = start.points[index];
    const c = constrain({ x: p.x + by.x, y: p.y + by.y }, start, start.mirror !== "none", index, held);
    const points = start.points.map((q, i) => (i === index ? { ...q, x: c.x, y: c.y } : q));
    return { shape: { ...start, points }, snapped: c.snapped };
  };

  const dragGesture = (g: DragGesture) => {
    if (g.phase === "start") drag = startDrag(g.from, g.pointerType, g.alt);
    if (!drag) return;
    if (drag.kind === "pan") return panGesture(g);
    if (drag.kind === "handle") return handleDrag(g, drag);
    if (drag.kind !== "move") return;
    drag.at = g.at;
    if (g.phase === "cancel") {
      selection = drag.selection;
      drag = null;
      return;
    }
    const delta = { x: (g.at.x - g.from.x) / view.scale, y: -(g.at.y - g.from.y) / view.scale };
    const { shape: start, index } = drag;
    const { shape, snapped } = movedBy(start, index, delta, drag.reflected, drag.snapped);
    drag.snapped = snapped;
    drag.live = state.shapes.map((s) => (s.id === shape.id ? shape : s));
    if (g.phase !== "end") return;
    // A drag that moved nothing (held against the page's edge) is no change, unless it added a point.
    const added = !state.shapes.includes(start);
    const same = shape.points.every((p, i) => p.x === start.points[i].x && p.y === start.points[i].y);
    if (added || !same) change({ ...state, shapes: drag.live });
    drag = null;
  };


  const undo = () => {
    endReframing();
    const prev = finished ? undefined : undoStack.pop();
    if (!prev) return;
    drag = null;
    const from = state;
    redoStack.push(state);
    setState(prev);
    settle(from);
  };
  const redo = () => {
    endReframing();
    const next = finished ? undefined : redoStack.pop();
    if (!next) return;
    drag = null;
    const from = state;
    undoStack.push(state);
    setState(next);
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
      const places = state.drawing !== null || (!hit && !selection);
      drag = places ? { kind: "aim", at: g.at, snapped: placeAt(g.at).snapped } : { kind: "held" };
      return;
    }
    if (drag?.kind === "aim") {
      drag.at = g.at;
      drag.snapped = placeAt(g.at, drag.snapped).snapped;
      if (g.phase === "end") place(g.at, drag.snapped);
      if (g.phase === "end" || g.phase === "cancel") drag = null;
    } else if (drag?.kind === "held") {
      if (g.phase === "move") return dragGesture({ ...g, type: "drag", phase: "start" });
      drag = null;
      if (g.phase === "end") tap(g.from);
    } else dragGesture({ ...g, type: "drag" });
  };

  /**
   * Nudge the selected handle, point or shape `by` screen px, the way the arrow points where it's drawn (on a
   * reflection too); a run of nudges is one undo step.
   */
  const nudge = (by: { x: number; y: number }): boolean => {
    const picked = selection;
    const shape = picked && state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return false;
    const delta = { x: by.x / view.scale, y: -by.y / view.scale };
    const reflected = !!picked.reflected;
    let next: Shape;
    const handle = picked.kind === "point" ? picked.handle : undefined;
    const knob = handle && knobs(state.shapes).find((h) => h.role === "own" && !h.stub && h.side === handle);
    if (knob) {
      const offset = { x: knob.tip.x - knob.base.x + delta.x, y: knob.tip.y - knob.base.y + delta.y };
      next = withKnob(knob, offset, false, false);
    } else if (picked.kind === "point") {
      const p = shape.points[picked.index];
      const by = reflected ? mirrorOffset(delta) : delta;
      const q = keep({ x: p.x + by.x, y: p.y + by.y }, shape, picked.index);
      next = { ...shape, points: shape.points.map((r, i) => (i === picked.index ? { ...r, ...q } : r)) };
    } else next = moveWhole(shape, reflected ? mirrorOffset(delta) : delta, page, axis);
    const same = JSON.stringify(next) === JSON.stringify(shape);
    if (same) return true;
    const after = { ...state, shapes: replace(next) };
    if (nudged?.state === state && nudged.selection === picked) state = after;
    else change(after);
    nudged = { state, selection: picked };
    return true;
  };

  /** Escape: cancel the drag under way, putting back what it moved (or the view a pan moved). */
  const cancelDrag = () => {
    if (drag?.kind === "move" || drag?.kind === "handle") selection = drag.selection;
    if (drag?.kind === "pan") view = drag.from;
    drag = null;
  };

  /** Backspace while drawing with nothing selected: take off the last point placed, and the shape with its only one. */
  const removeLast = () => {
    const shape = drawingShape()!;
    const points = shape.points.slice(0, -1);
    if (points.length > 0) change({ ...state, shapes: replace({ ...shape, points }) });
    else change({ ...state, shapes: state.shapes.filter((s) => s !== shape), drawing: null });
  };

  /** Zoom by `factor` about the canvas's middle. */
  const zoomBy = (factor: number) => {
    const middle = { x: size.width / 2, y: size.height / 2 };
    view = pinchZoom(view, fitScale(page, size.width, size.height), middle, middle, factor);
    moved = true;
  };

  const key = ({ key: k, ctrl, shift }: KeyInput): boolean => {
    if (finished || size.width === 0) return false;
    endReframing();
    const lower = k.toLowerCase();
    const drawing = state.drawing !== null;
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
      const shape = drawingShape();
      if (shape) return can(true, shape.points.length >= 3 ? close : end);
      return can(openEnd() !== null, carryOn);
    }
    if (k === "Escape") {
      if (drag) return can(true, cancelDrag);
      if (drawing) return can(true, end);
      return can(selection !== null, () => (selection = null));
    }
    if (k === "Delete" || k === "Backspace") {
      if (selection) return can(true, remove);
      return can(k === "Backspace" && drawing, removeLast);
    }
    if (lower === "s") return can(selection?.kind === "point" && !drawing, toggleSelected);
    if (lower === "m") return can(true, toggleSymmetry);
    if (k === "+" || k === "=") return can(true, () => zoomBy(KEY_ZOOM_STEP));
    if (k === "-") return can(true, () => zoomBy(1 / KEY_ZOOM_STEP));
    if (k === "0") {
      moved = false;
      view = fitView(page, size.width, size.height);
      return true;
    }
    const arrow = ARROWS.get(k);
    if (!arrow) return false;
    const step = shift ? SHIFT_NUDGE_PX : NUDGE_PX;
    return nudge({ x: arrow.x * step, y: arrow.y * step });
  };

  const gesture = (g: Gesture) => {
    if (g.type === "hover") {
      pointer = g.at && { at: g.at, pans: g.pans };
      return;
    }
    if (finished || size.width === 0) return;
    endReframing();
    // A mouse or pen still hovers where its drag ended.
    const ends = (g.type === "drag" || g.type === "pan") && (g.phase === "end" || g.phase === "cancel");
    if (ends && g.pointerType !== "touch") pointer = { at: g.at, pans: pointer?.pans ?? false };
    const fit = () => fitScale(page, size.width, size.height);
    const zoomTo = (next: ViewTransform) => {
      view = next;
      moved = true;
    };
    if (g.type === "tap") firstTap(g.at);
    else if (g.type === "doubleTap") doubleTap(g.at);
    else if (g.type === "drag") dragGesture(g);
    else if (g.type === "hold") holdGesture(g);
    else if (g.type === "pan") panGesture(g);
    else if (g.type === "multiTap") (g.fingers === 2 ? undo : redo)();
    else if (g.type === "wheel") zoomTo(wheelZoom(view, fit(), g.at, g.deltaY));
    else if (g.type === "pinch") zoomTo(pinchZoom(view, fit(), g.from, g.at, g.scale));
  };

  /**
   * A point being placed or dragged is snapped onto the axis, so it's highlighted; while hovering, where a click
   * would place one.
   */
  const snapping = (): boolean => {
    if (drag?.kind === "aim") return drag.snapped;
    if (drag?.kind === "move") return drag.index !== null && drag.snapped;
    if (drag || finished || !pointer || pointer.pans) return false;
    return tapAction(pointer.at).do === "place" && placeAt(pointer.at).snapped;
  };

  /** The loupe for the drag or hold under way, if it's by touch and aims at a point: clear of the finger. */
  const loupe = (shapes: readonly Shape[]): Loupe | null => {
    if (drag?.kind === "aim") return loupeAt(drag.at, toScreen(view, placeAt(drag.at, drag.snapped).point));
    if (drag?.kind === "handle" && drag.loupe) {
      // Centred on the handle's tip, or on its point once it's dragged back onto it.
      const { shape, o, k, side, base: p } = drag.knob;
      const h = handleAt(shapes.find((s) => s.id === shape.id) ?? shape, o, k, side);
      return loupeAt(drag.at, toScreen(view, h ? { x: p.x + h.x, y: p.y + h.y } : p));
    }
    if (drag?.kind !== "move" || !drag.loupe || drag.index === null) return null;
    const { shape, index, reflected } = drag;
    const found = nodeOf(shapes.find((s) => s.id === shape.id) ?? shape, index, reflected);
    return found && loupeAt(drag.at, toScreen(view, found.at));
  };
  const loupeAt = (finger: ScreenPoint, focus: ScreenPoint): Loupe => placeLoupe(finger, focus, size.width);

  const pill = (): Pill => {
    const shape = drawingShape();
    if (shape) return { kind: "drawing", points: shape.points.length, canClose: shape.points.length >= 3 };
    if (selection?.kind === "point") {
      const { shape: id, index } = selection;
      const smooth = state.shapes.find((s) => s.id === id)?.points[index]?.kind === "smooth";
      return { kind: "point", canCarryOn: openEnd() !== null, smooth };
    }
    if (selection?.kind === "shape") return { kind: "shape" };
    return { kind: "hint", text: HINT };
  };

  const drawn = (): Drawn => {
    const screen = (p: { x: number; y: number }) => toScreen(view, p);
    /** The circle through a box's corners, on screen. */
    const ring = (box: BBox) => ({
      at: screen({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }),
      r: (Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2) * view.scale,
    });
    // Marked only for the Design they were found in; a move under way keeps them where they were.
    const current = warnings?.design === design() ? warnings.warnings : [];
    const corner = screen({ x: 0, y: page.height });
    // A move under way shows as it would end.
    const shapes = ((drag?.kind === "move" || drag?.kind === "handle") && drag.live) || state.shapes;
    const picked = selection?.kind === "point" ? selection : null;
    const handles = knobs(shapes).map(({ base, side, tip, stub, role }) => ({
      from: screen(base),
      to: screen(tip),
      kind: stub ? ("stub" as const) : role,
      selected: !stub && role === "own" && picked?.handle === side,
    }));
    const chosen = picked && shapes.find((s) => s.id === picked.shape);
    const pickedNode = chosen && nodeOf(chosen, picked.index, !!picked.reflected);
    const open = shapes.filter((s) => !s.closed).length;
    const mirrored = (id: number | null | undefined) => shapes.some((s) => s.id === id && s.mirror !== "none");
    // The axis shows over a photo only while it's needed: Symmetry on, or a mirrored shape picked or being drawn.
    const showsAxis = !options.photo || symmetry || mirrored(selection?.shape) || mirrored(state.drawing);
    return {
      page: { ...corner, width: page.width * view.scale, height: page.height * view.scale },
      grid: !options.photo,
      axis: showsAxis
        ? { from: screen({ x: axis, y: page.height }), to: screen({ x: axis, y: 0 }), snapped: snapping() }
        : null,
      fill: pathData(
        shapes.filter((s) => s.closed),
        screen,
        axis,
      ),
      shapes: shapes.map((s) => ({
        id: s.id,
        d: pathData([s], screen, axis),
        closed: s.closed,
        drawing: s.id === state.drawing,
        selected: s.id === selection?.shape,
      })),
      // Reflections' points too, as the drawn side's.
      points: shapes.flatMap((s) =>
        outlines(s).flatMap((outline, o) =>
          outline.nodes.map(({ index: i }, k) => ({
            at: screen(outline.shape.points[k]),
            kind: s.points[i].kind,
            end: !s.closed && (i === 0 || i === s.points.length - 1),
            closable: s.id === state.drawing && i === 0 && s.points.length >= 3,
            selected: chosen === s && pickedNode?.o === o && pickedNode.k === k,
          })),
        ),
      ),
      handles,
      pill: pill(),
      markers: markers(shapes).map((m) => screen(m.at)),
      note: open === 0 ? null : `${open} ${open === 1 ? "shape isn't" : "shapes aren't"} closed and won't be carved`,
      can: { undo: undoStack.length > 0, redo: redoStack.length > 0, clear: state.shapes.length > 0 },
      tools: !finished,
      symmetry,
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
      size = { width, height };
      if (!moved && width > 0 && height > 0) view = fitView(page, width, height);
    },
    gesture,
    key,
    close: () => !finished && close(),
    end: () => !finished && end(),
    delete: () => !finished && remove(),
    carryOn: () => !finished && carryOn(),
    clearSelection() {
      selection = null;
    },
    toggleKind: () => !finished && toggleSelected(),
    toggleSymmetry: () => !finished && toggleSymmetry(),
    clear() {
      if (finished || state.shapes.length === 0) return;
      change({ ...state, shapes: [], drawing: null });
      selection = null;
    },
    replace(shapes) {
      if (finished) return;
      change({ ...state, shapes: shapes.map((s) => ({ ...s, id: nextId++ })), drawing: null });
      selection = null;
    },
    undo,
    redo,
    done() {
      end();
      selection = null;
      drag = null;
      finished = true;
    },
    edit() {
      finished = false;
    },
    isDone: () => finished,
    drawn,
    design,
    pathData: closedPathData,
    shapePaths: (map) => ({
      closed: pathData(
        state.shapes.filter((s) => s.closed),
        map,
        axis,
      ),
      open: pathData(
        state.shapes.filter((s) => !s.closed),
        map,
        axis,
      ),
    }),
    shapes: () => state.shapes,
    record() {
      const shown = committed();
      if (recordOf?.state !== shown || recordOf.finished !== finished || recordOf.symmetry !== symmetry) {
        const record = { shapes: [...shown.shapes], drawing: shown.drawing, done: finished, ...(symmetry && { symmetry }) };
        recordOf = { state: shown, finished, symmetry, record };
      }
      return recordOf.record;
    },
    page: () => page,
    changeCleanup,
    cleanup: () => state.cleanup as C | null,
    counts: () => ({
      points: state.shapes.reduce((n, s) => n + s.points.length, 0),
      open: state.shapes.filter((s) => !s.closed).length,
    }),
    showWarnings(next) {
      warnings = { design: design(), warnings: next };
    },
  };
}

/**
 * The loupe for a finger at `finger` aiming at `focus`, on a canvas `width` px across: above the finger, or beside
 * it (on whichever side there's room) when there's no room above, and kept inside the canvas. The canvas's and
 * Cleanup's frame corners' alike.
 */
export function placeLoupe(finger: ScreenPoint, focus: ScreenPoint, width: number): Loupe {
  let x = finger.x - LOUPE_PX / 2;
  let y = finger.y - LOUPE_GAP_PX - LOUPE_PX;
  if (y < LOUPE_MARGIN_PX) {
    y = Math.max(LOUPE_MARGIN_PX, finger.y - LOUPE_PX / 2);
    const right = finger.x + LOUPE_GAP_PX;
    x = right + LOUPE_PX <= width - LOUPE_MARGIN_PX ? right : finger.x - LOUPE_GAP_PX - LOUPE_PX;
  }
  x = Math.min(width - LOUPE_MARGIN_PX - LOUPE_PX, Math.max(LOUPE_MARGIN_PX, x));
  return { box: { x, y, width: LOUPE_PX, height: LOUPE_PX }, focus, magnification: LOUPE_MAGNIFICATION };
}

/** `design` with its box widened evenly about the axis at x = `axis`, so the axis is its middle. */
function aboutAxis(design: Design, axis: number): Design {
  const half = Math.max(axis - design.bbox.minX, design.bbox.maxX - axis);
  return { ...design, bbox: { ...design.bbox, minX: axis - half, maxX: axis + half } };
}

/** How long a polyline is, end to end. */
function polylineLength(pts: readonly XY[]): number {
  return pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)), 0);
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
