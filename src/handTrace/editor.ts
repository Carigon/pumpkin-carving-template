import { distanceToSegment, insidePolygon, signedArea, type BBox, type Design, type TemplateWarning } from "../core";
import type { DragGesture, Gesture, HoldGesture, PanGesture, PointerKind, ScreenPoint } from "./gestures";
import type { HandTraceRecord, Page, Point, Shape } from "./model";
import { loopsPathData, pathData } from "./pathData";
import { fitScale, fitView, pinchZoom, toDesignSpace, toScreen, wheelZoom, type ViewTransform } from "./view";

/** What the editor needs from outside. */
export interface HandTraceOptions {
  /**
   * The one route from path data (SVG space, y down) to the core's `Design`: `designFromPathData` in `src/input`,
   * which flattens at the loader's tolerance. Passed in because the editor can't import outside the core.
   */
  toDesign: (pathData: string) => Design | null;
  /** The page the points are placed on; a blank page (1 × 1) when left out. */
  page?: Page;
  /** The stored record to reopen (validated by the record module), as after a reload; nothing drawn when left out. */
  record?: HandTraceRecord;
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
 * What the floating pill offers: the point count with Close and End while drawing; Delete point, Carry on (on an
 * open end) and clearing the selection with a point selected; Delete shape and clearing with a shape selected;
 * otherwise a hint.
 */
export type Pill =
  | { kind: "drawing"; points: number; canClose: boolean }
  | { kind: "point"; canCarryOn: boolean }
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
  /** The blank page, faintly gridded. */
  page: ScreenRect;
  /** The symmetry axis, down the page's middle. */
  axis: { from: ScreenPoint; to: ScreenPoint };
  /** Every closed shape's outline in one path, filled even-odd: what's carved. */
  fill: string;
  shapes: DrawnShape[];
  points: DrawnPoint[];
  pill: Pill;
  /** The selected shape's insert markers, while no shape is being drawn. */
  markers: ScreenPoint[];
  /** "1 shape isn't closed and won't be carved" while any open shape exists. */
  note: string | null;
  /** Which of the Undo, Redo and Clear buttons can act. */
  can: { undo: boolean; redo: boolean; clear: boolean };
  /** The tools (buttons, pill, note) show and the canvas takes input: false once Done. */
  tools: boolean;
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

/** What a hovering click would act on: a point or insert marker where it's drawn, or a shape by its id. */
export type HoverMark = { kind: "point" | "marker"; at: ScreenPoint } | { kind: "shape"; id: number };

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
export interface HandTrace {
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
   * The pill's Delete point or Delete shape, as one undo step. A shape left too small goes too: a closed shape
   * under 3 points, or an open shape with none.
   */
  delete(): void;
  /** The pill's Carry on: with an open shape's end point selected, carry on drawing that shape from it. */
  carryOn(): void;
  /** The pill's ✕: select nothing. */
  clearSelection(): void;
  /** Remove every shape, as one undo step. */
  clear(): void;
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

/** Screen radius (px) within which a tap hits a point or an outline, whatever the zoom. */
const HIT_RADIUS_PX = 22;
/** Edges shorter than this on screen (px) show no insert marker. */
const MARKER_MIN_EDGE_PX = 48;
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

/** The shapes and which one is being drawn: what an undo step puts back. */
interface State {
  shapes: readonly Shape[];
  drawing: number | null;
}

/** What's under a tap or the start of a drag: a point (its shape and index), or a shape by its outline or inside. */
type Hit =
  | { kind: "point"; shape: Shape; index: number }
  | { kind: "marker"; marker: Marker }
  | { kind: "shape"; shape: Shape };

/** An insert marker: in the middle of `shape`'s edge from point `after` to the next, in design space. */
interface Marker {
  shape: Shape;
  after: number;
  at: { x: number; y: number };
}

/** What's selected: one point (by its shape and index) or one shape. Selecting isn't an undo step. */
type Selection = { kind: "point"; shape: number; index: number } | { kind: "shape"; shape: number };

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
 * (`index` null); aiming the loupe at where a point will be placed, the finger `at`; or a hold that's waiting to
 * be a tap or a drag. A move is shown as `live` and kept out of the shapes until it ends, as one undo step;
 * `selection` is what was selected before, put back if the drag is cancelled; `loupe` says it's by touch.
 */
type Drag =
  | { kind: "pan"; from: ViewTransform }
  | {
      kind: "move";
      shape: Shape;
      index: number | null;
      live: readonly Shape[] | null;
      selection: Selection | null;
      at: ScreenPoint;
      loupe: boolean;
    }
  | { kind: "aim"; at: ScreenPoint }
  | { kind: "held" };

/** A blank page: square, with points relative to its size. */
const BLANK_PAGE: Page = { width: 1, height: 1 };

export function createHandTrace(options: HandTraceOptions): HandTrace {
  const page = options.page ?? BLANK_PAGE;
  const reopened = options.record;
  let state: State = { shapes: reopened?.shapes ?? [], drawing: reopened?.drawing ?? null };
  const undoStack: State[] = [];
  let redoStack: State[] = [];
  let nextId = Math.max(0, ...state.shapes.map((s) => s.id)) + 1;
  let selection: Selection | null = null;
  let finished = reopened?.done ?? false;
  /** The record last handed out, and what it was made from. */
  let recordOf: { state: State; finished: boolean; record: HandTraceRecord } | null = null;
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

  // SVG space is y down: flip on the way out, as the loader flips back.
  const closedPathData = () =>
    pathData(
      state.shapes.filter((s) => s.closed),
      ({ x, y }) => ({ x, y: -y }),
    );
  const design = (): Design | null => {
    if (designOf?.shapes !== state.shapes) {
      const d = closedPathData();
      designOf = { shapes: state.shapes, design: d ? options.toDesign(d) : null };
    }
    return designOf.design;
  };

  const drawingShape = () => state.shapes.find((s) => s.id === state.drawing) ?? null;

  /** Make a change to the shapes, as one undo step. A move under way is dropped: it was built on the old shapes. */
  const change = (next: State) => {
    drag = null;
    undoStack.push(state);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    state = next;
  };
  const replace = (shape: Shape): readonly Shape[] => state.shapes.map((s) => (s.id === shape.id ? shape : s));

  /** A screen position as a point on the page, clamped to it. */
  const placeAt = (at: ScreenPoint): Point => {
    const p = toDesignSpace(view, at);
    return {
      x: Math.min(page.width, Math.max(0, p.x)),
      y: Math.min(page.height, Math.max(0, p.y)),
      kind: "corner",
    };
  };

  const place = (at: ScreenPoint) => {
    const point = placeAt(at);
    const shape = drawingShape();
    if (shape) change({ ...state, shapes: replace({ ...shape, points: [...shape.points, point] }) });
    else {
      const id = nextId++;
      change({ shapes: [...state.shapes, { id, closed: false, mirror: "none", points: [point] }], drawing: id });
    }
  };

  const close = () => {
    const shape = drawingShape();
    if (!shape || shape.points.length < 3) return;
    change({ shapes: replace({ ...shape, closed: true }), drawing: null });
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
    state = { shapes, drawing: shape.id };
    selection = null;
    drag = null;
  };

  /** Delete the selected point or shape, and a shape the point leaves too small. */
  const remove = () => {
    const picked = selection;
    const shape = picked && state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    const points = picked.kind === "point" ? shape.points.filter((_, i) => i !== picked.index) : [];
    const gone = points.length === 0 || (shape.closed && points.length < 3);
    const shapes = gone ? state.shapes.filter((s) => s !== shape) : replace({ ...shape, points });
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

  /** The insert markers on `shapes`' selected shape: one at the middle of each edge long enough on screen. */
  const markers = (shapes: readonly Shape[]): Marker[] => {
    const shape = state.drawing === null && selection && shapes.find((s) => s.id === selection?.shape);
    if (!shape) return [];
    const pts = shape.points;
    const edges = shape.closed ? pts.length : pts.length - 1;
    const out: Marker[] = [];
    for (let i = 0; i < edges; i++) {
      const [u, v] = [pts[i], pts[(i + 1) % pts.length]];
      if (Math.hypot(v.x - u.x, v.y - u.y) * view.scale < MARKER_MIN_EDGE_PX) continue;
      out.push({ shape, after: i, at: { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 } });
    }
    return out;
  };

  /**
   * What's under screen point `at`: the nearest point within the hit radius (the shape being drawn winning ties),
   * else the nearest insert marker within it, else the nearest outline within it, else the smallest closed shape
   * it's inside.
   */
  const hitTest = (at: ScreenPoint): Hit | null => pointAt(at) ?? markerAt(at) ?? outlineAt(at) ?? insideAt(at);
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
  const pointAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    const order = [...state.shapes].sort((a, b) => Number(b.id === state.drawing) - Number(a.id === state.drawing));
    for (const shape of order) {
      shape.points.forEach((p, index) => {
        const s = toScreen(view, p);
        const d = Math.hypot(s.x - at.x, s.y - at.y);
        if (d < bestDistance) [best, bestDistance] = [{ kind: "point", shape, index }, d];
      });
    }
    return best;
  };
  /** Edges are taken as straight. */
  const outlineAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const shape of state.shapes) {
      const pts = shape.points.map((p) => toScreen(view, p));
      const edges = shape.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < edges; i++) {
        const d = distanceToSegment(at, pts[i], pts[(i + 1) % pts.length]);
        if (d < bestDistance) [best, bestDistance] = [{ kind: "shape", shape }, d];
      }
    }
    return best;
  };
  const insideAt = (at: ScreenPoint): Hit | null => {
    const p = toDesignSpace(view, at);
    const around = state.shapes.filter((s) => s.closed && insidePolygon(p, s.points));
    const area = (s: Shape) => Math.abs(signedArea(s.points));
    const smallest = around.sort((a, b) => area(a) - area(b))[0];
    return smallest ? { kind: "shape", shape: smallest } : null;
  };

  /** What a tap at `at` would do, by what's under it and whether a shape is being drawn. */
  const tapAction = (at: ScreenPoint): TapAction => {
    const hit = hitTest(at);
    const shape = drawingShape();
    if (hit?.kind === "point") {
      const selects: TapAction = { do: "select", hit, selection: { kind: "point", shape: hit.shape.id, index: hit.index } };
      if (!shape || hit.shape.id !== shape.id) return selects;
      if (hit.index === shape.points.length - 1) return { do: "end", hit };
      if (hit.index === 0) return shape.points.length >= 3 ? { do: "close", hit } : { do: "nothing" };
      return { do: "place" };
    }
    if (shape) return { do: "place" };
    if (hit?.kind === "marker") return { do: "insert", hit };
    if (hit) return { do: "select", hit, selection: { kind: "shape", shape: hit.shape.id } };
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
      const { shape, index } = insert(action.hit.marker);
      change({ ...state, shapes: replace(shape) });
      selection = { kind: "point", shape: shape.id, index };
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
    if (action.do === "place") return { hover: null, cursor: "crosshair", rubberBand: band(placeAt(pointer.at)) };
    if (action.do === "deselect" || action.do === "nothing") return { ...none, cursor: "default" };
    const { hit } = action;
    if (hit.kind === "shape") {
      const picked = selection?.kind === "shape" && selection.shape === hit.shape.id;
      return { hover: { kind: "shape", id: hit.shape.id }, cursor: picked ? "move" : "pointer", rubberBand: null };
    }
    const at = hit.kind === "point" ? hit.shape.points[hit.index] : hit.marker.at;
    const rubberBand = action.do === "close" ? band(at) : null;
    return { hover: { kind: hit.kind, at: toScreen(view, at) }, cursor: "pointer", rubberBand };
  };

  /** `marker`'s shape with a corner point added at the marker, and the new point's index. */
  const insert = ({ shape, after, at }: Marker): { shape: Shape; index: number } => {
    const points = [...shape.points];
    points.splice(after + 1, 0, { ...at, kind: "corner" });
    return { shape: { ...shape, points }, index: after + 1 };
  };

  /**
   * What a drag starting at `from` does: move the point under it, add a point at the insert marker under it and
   * move that, move the selected shape, or pan.
   */
  const startDrag = (from: ScreenPoint, pointerType: PointerKind): Drag => {
    const hit = hitTest(from);
    const moving = { live: null, selection, at: from, loupe: pointerType === "touch" };
    if (hit?.kind === "point") {
      if (hit.shape.id !== state.drawing) {
        end();
        selection = { kind: "point", shape: hit.shape.id, index: hit.index };
      }
      return { kind: "move", shape: hit.shape, index: hit.index, ...moving };
    }
    if (hit?.kind === "marker") {
      const { shape, index } = insert(hit.marker);
      selection = { kind: "point", shape: shape.id, index };
      return { kind: "move", shape, index, ...moving };
    }
    if (hit && selection?.kind === "shape" && selection.shape === hit.shape.id)
      return { kind: "move", shape: hit.shape, index: null, ...moving, loupe: false };
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

  const dragGesture = (g: DragGesture) => {
    if (g.phase === "start") drag = startDrag(g.from, g.pointerType);
    if (!drag) return;
    if (drag.kind === "pan") return panGesture(g);
    if (drag.kind !== "move") return;
    drag.at = g.at;
    if (g.phase === "cancel") {
      selection = drag.selection;
      drag = null;
      return;
    }
    const delta = { x: (g.at.x - g.from.x) / view.scale, y: -(g.at.y - g.from.y) / view.scale };
    const { shape: start, index } = drag;
    const shape = moveBy(start, index, delta, page);
    drag.live = state.shapes.map((s) => (s.id === shape.id ? shape : s));
    if (g.phase !== "end") return;
    // A drag that moved nothing (held against the page's edge) is no change, unless it added a point.
    const added = !state.shapes.includes(start);
    const same = shape.points.every((p, i) => p.x === start.points[i].x && p.y === start.points[i].y);
    if (added || !same) change({ ...state, shapes: drag.live });
    drag = null;
  };

  const undo = () => {
    const prev = finished ? undefined : undoStack.pop();
    if (!prev) return;
    drag = null;
    const from = state;
    redoStack.push(state);
    state = prev;
    settle(from);
  };
  const redo = () => {
    const next = finished ? undefined : redoStack.pop();
    if (!next) return;
    drag = null;
    const from = state;
    undoStack.push(state);
    state = next;
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
      if (hit?.kind === "point" || hit?.kind === "marker") return dragGesture({ ...g, type: "drag" });
      const places = state.drawing !== null || (!hit && !selection);
      drag = places ? { kind: "aim", at: g.at } : { kind: "held" };
      return;
    }
    if (drag?.kind === "aim") {
      drag.at = g.at;
      if (g.phase === "end") place(g.at);
      if (g.phase === "end" || g.phase === "cancel") drag = null;
    } else if (drag?.kind === "held") {
      if (g.phase === "move") return dragGesture({ ...g, type: "drag", phase: "start" });
      drag = null;
      if (g.phase === "end") tap(g.from);
    } else dragGesture({ ...g, type: "drag" });
  };

  /** Nudge the selected point or shape `by` screen px; a run of nudges is one undo step. */
  const nudge = (by: { x: number; y: number }): boolean => {
    const picked = selection;
    const shape = picked && state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return false;
    const index = picked.kind === "point" ? picked.index : null;
    const next = moveBy(shape, index, { x: by.x / view.scale, y: -by.y / view.scale }, page);
    const same = next.points.every((p, i) => p.x === shape.points[i].x && p.y === shape.points[i].y);
    if (same) return true;
    const after = { ...state, shapes: replace(next) };
    if (nudged?.state === state && nudged.selection === picked) state = after;
    else change(after);
    nudged = { state, selection: picked };
    return true;
  };

  /** Escape: cancel the drag under way, putting back what it moved (or the view a pan moved). */
  const cancelDrag = () => {
    if (drag?.kind === "move") selection = drag.selection;
    if (drag?.kind === "pan") view = drag.from;
    drag = null;
  };

  /** Backspace while drawing with nothing selected: take off the last point placed, and the shape with its only one. */
  const removeLast = () => {
    const shape = drawingShape()!;
    const points = shape.points.slice(0, -1);
    if (points.length > 0) change({ ...state, shapes: replace({ ...shape, points }) });
    else change({ shapes: state.shapes.filter((s) => s !== shape), drawing: null });
  };

  /** Zoom by `factor` about the canvas's middle. */
  const zoomBy = (factor: number) => {
    const middle = { x: size.width / 2, y: size.height / 2 };
    view = pinchZoom(view, fitScale(page, size.width, size.height), middle, middle, factor);
    moved = true;
  };

  const key = ({ key: k, ctrl, shift }: KeyInput): boolean => {
    if (finished || size.width === 0) return false;
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
    // A mouse or pen still hovers where its drag ended.
    const ends = (g.type === "drag" || g.type === "pan") && (g.phase === "end" || g.phase === "cancel");
    if (ends && g.pointerType !== "touch") pointer = { at: g.at, pans: pointer?.pans ?? false };
    const fit = () => fitScale(page, size.width, size.height);
    const zoomTo = (next: ViewTransform) => {
      view = next;
      moved = true;
    };
    if (g.type === "tap") tap(g.at);
    else if (g.type === "drag") dragGesture(g);
    else if (g.type === "hold") holdGesture(g);
    else if (g.type === "pan") panGesture(g);
    else if (g.type === "multiTap") (g.fingers === 2 ? undo : redo)();
    else if (g.type === "wheel") zoomTo(wheelZoom(view, fit(), g.at, g.deltaY));
    else if (g.type === "pinch") zoomTo(pinchZoom(view, fit(), g.from, g.at, g.scale));
  };

  /** The loupe for the drag or hold under way, if it's by touch and aims at a point: clear of the finger. */
  const loupe = (shapes: readonly Shape[]): Loupe | null => {
    if (drag?.kind === "aim") return loupeAt(drag.at, toScreen(view, placeAt(drag.at)));
    if (drag?.kind !== "move" || !drag.loupe || drag.index === null) return null;
    const { shape, index } = drag;
    const point = (shapes.find((s) => s.id === shape.id) ?? shape).points[index];
    return loupeAt(drag.at, toScreen(view, point));
  };
  const loupeAt = (finger: ScreenPoint, focus: ScreenPoint): Loupe => {
    // Above the finger; beside it, on whichever side there's room, when there's no room above.
    let x = finger.x - LOUPE_PX / 2;
    let y = finger.y - LOUPE_GAP_PX - LOUPE_PX;
    if (y < LOUPE_MARGIN_PX) {
      y = Math.max(LOUPE_MARGIN_PX, finger.y - LOUPE_PX / 2);
      const right = finger.x + LOUPE_GAP_PX;
      x = right + LOUPE_PX <= size.width - LOUPE_MARGIN_PX ? right : finger.x - LOUPE_GAP_PX - LOUPE_PX;
    }
    x = Math.min(size.width - LOUPE_MARGIN_PX - LOUPE_PX, Math.max(LOUPE_MARGIN_PX, x));
    return { box: { x, y, width: LOUPE_PX, height: LOUPE_PX }, focus, magnification: LOUPE_MAGNIFICATION };
  };

  const pill = (): Pill => {
    const shape = drawingShape();
    if (shape) return { kind: "drawing", points: shape.points.length, canClose: shape.points.length >= 3 };
    if (selection?.kind === "point") return { kind: "point", canCarryOn: openEnd() !== null };
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
    const shapes = (drag?.kind === "move" && drag.live) || state.shapes;
    const open = shapes.filter((s) => !s.closed).length;
    return {
      page: { ...corner, width: page.width * view.scale, height: page.height * view.scale },
      axis: { from: screen({ x: page.width / 2, y: page.height }), to: screen({ x: page.width / 2, y: 0 }) },
      fill: pathData(
        shapes.filter((s) => s.closed),
        screen,
      ),
      shapes: shapes.map((s) => ({
        id: s.id,
        d: pathData([s], screen),
        closed: s.closed,
        drawing: s.id === state.drawing,
        selected: s.id === selection?.shape,
      })),
      points: shapes.flatMap((s) =>
        s.points.map((p, i) => ({
          at: screen(p),
          kind: p.kind,
          end: !s.closed && (i === 0 || i === s.points.length - 1),
          closable: s.id === state.drawing && i === 0 && s.points.length >= 3,
          selected: selection?.kind === "point" && selection.shape === s.id && selection.index === i,
        })),
      ),
      pill: pill(),
      markers: markers(shapes).map((m) => screen(m.at)),
      note: open === 0 ? null : `${open} ${open === 1 ? "shape isn't" : "shapes aren't"} closed and won't be carved`,
      can: { undo: undoStack.length > 0, redo: redoStack.length > 0, clear: state.shapes.length > 0 },
      tools: !finished,
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
    clear() {
      if (finished || state.shapes.length === 0) return;
      change({ shapes: [], drawing: null });
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
    shapes: () => state.shapes,
    record() {
      if (recordOf?.state !== state || recordOf.finished !== finished) {
        recordOf = { state, finished, record: { shapes: [...state.shapes], drawing: state.drawing, done: finished } };
      }
      return recordOf.record;
    },
    page: () => page,
    counts: () => ({
      points: state.shapes.reduce((n, s) => n + s.points.length, 0),
      open: state.shapes.filter((s) => !s.closed).length,
    }),
    showWarnings(next) {
      warnings = { design: design(), warnings: next };
    },
  };
}

/** `shape` with its point `index` (or, with `index` null, every point) moved by `delta`, kept on `page`. */
function moveBy(shape: Shape, index: number | null, delta: { x: number; y: number }, page: Page): Shape {
  if (index !== null) {
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    const points = shape.points.map((p, i) =>
      i === index ? { ...p, x: clamp(p.x + delta.x, page.width), y: clamp(p.y + delta.y, page.height) } : p,
    );
    return { ...shape, points };
  }
  // A whole shape stops at the page's edge rather than squashing against it; one already over the edge (imported)
  // can still move back.
  const stop = (d: number, values: number[], max: number) =>
    Math.min(Math.max(0, max - Math.max(...values)), Math.max(Math.min(0, -Math.min(...values)), d));
  const dx = stop(delta.x, shape.points.map((p) => p.x), page.width);
  const dy = stop(delta.y, shape.points.map((p) => p.y), page.height);
  return { ...shape, points: shape.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}
