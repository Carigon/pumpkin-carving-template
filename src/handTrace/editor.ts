import { distanceToSegment, insidePolygon, signedArea, type Design } from "../core";
import type { DragGesture, Gesture, ScreenPoint } from "./gestures";
import type { Page, Point, Shape } from "./model";
import { pathData } from "./pathData";
import { fitScale, fitView, toDesignSpace, toScreen, wheelZoom, type ViewTransform } from "./view";

/** What the editor needs from outside. */
export interface HandTraceOptions {
  /**
   * The one route from path data (SVG space, y down) to the core's `Design`: `designFromPathData` in `src/input`,
   * which flattens at the loader's tolerance. Passed in because the editor can't import outside the core.
   */
  toDesign: (pathData: string) => Design | null;
  /** The page the points are placed on; a blank page (1 × 1) when left out. */
  page?: Page;
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
}

/** The hand-trace editor: commands and gestures in; what's drawn, the `Design` and the shapes out. */
export interface HandTrace {
  /** The canvas is now `width` × `height` px; the page refits unless the carver has panned or zoomed. */
  resize(width: number, height: number): void;
  gesture(g: Gesture): void;
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
  /** The shapes, in the order drawn, as the stored record holds them. */
  shapes(): readonly Shape[];
  /** How many points there are in all, and how many shapes are open. */
  counts(): { points: number; open: number };
}

/** Screen radius (px) within which a tap hits a point or an outline, whatever the zoom. */
const HIT_RADIUS_PX = 22;
/** Edges shorter than this on screen (px) show no insert marker. */
const MARKER_MIN_EDGE_PX = 48;
/** Undo steps kept; older ones are dropped. */
const UNDO_LIMIT = 200;
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
 * A drag under way: a pan from the view it started at, or a move of one point (`index`) or of a whole shape
 * (`index` null). A move is shown as `live` and kept out of the shapes until it ends, as one undo step; `selection`
 * is what was selected before, put back if the drag is cancelled.
 */
type Drag =
  | { kind: "pan"; from: ViewTransform }
  | { kind: "move"; shape: Shape; index: number | null; live: readonly Shape[] | null; selection: Selection | null };

/** A blank page: square, with points relative to its size. */
const BLANK_PAGE: Page = { width: 1, height: 1 };

export function createHandTrace(options: HandTraceOptions): HandTrace {
  const page = options.page ?? BLANK_PAGE;
  let state: State = { shapes: [], drawing: null };
  const undoStack: State[] = [];
  let redoStack: State[] = [];
  let nextId = 1;
  let selection: Selection | null = null;
  let finished = false;
  let size = { width: 0, height: 0 };
  let view: ViewTransform = fitView(page, 1, 1);
  /** The carver has panned or zoomed, so a resize keeps the view. */
  let moved = false;
  let drag: Drag | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;

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

  /** What a tap does, by what's under it and whether a shape is being drawn. */
  const tap = (at: ScreenPoint) => {
    const hit = hitTest(at);
    const shape = drawingShape();
    if (shape) {
      if (hit?.kind !== "point") return place(at);
      if (hit.shape.id !== shape.id) {
        end();
        selection = { kind: "point", shape: hit.shape.id, index: hit.index };
        return;
      }
      const last = shape.points.length - 1;
      if (hit.index === last) end();
      else if (hit.index === 0) close();
      else place(at);
      return;
    }
    if (hit?.kind === "point") selection = { kind: "point", shape: hit.shape.id, index: hit.index };
    else if (hit?.kind === "marker") {
      const { shape, index } = insert(hit.marker);
      change({ ...state, shapes: replace(shape) });
      selection = { kind: "point", shape: shape.id, index };
    } else if (hit) selection = { kind: "shape", shape: hit.shape.id };
    else if (selection) selection = null;
    else place(at);
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
  const startDrag = (from: ScreenPoint): Drag => {
    const hit = hitTest(from);
    if (hit?.kind === "point") {
      const before = selection;
      if (hit.shape.id !== state.drawing) {
        end();
        selection = { kind: "point", shape: hit.shape.id, index: hit.index };
      }
      return { kind: "move", shape: hit.shape, index: hit.index, live: null, selection: before };
    }
    if (hit?.kind === "marker") {
      const before = selection;
      const { shape, index } = insert(hit.marker);
      selection = { kind: "point", shape: shape.id, index };
      return { kind: "move", shape, index, live: null, selection: before };
    }
    if (hit && selection?.kind === "shape" && selection.shape === hit.shape.id)
      return { kind: "move", shape: hit.shape, index: null, live: null, selection };
    return { kind: "pan", from: view };
  };

  const dragGesture = (g: DragGesture) => {
    if (g.phase === "start") drag = startDrag(g.from);
    if (!drag) return;
    if (drag.kind === "pan") {
      view = { ...drag.from, tx: drag.from.tx + g.at.x - g.from.x, ty: drag.from.ty + g.at.y - g.from.y };
      moved = true;
      if (g.phase === "end" || g.phase === "cancel") drag = null;
      return;
    }
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

  const gesture = (g: Gesture) => {
    if (finished || size.width === 0) return;
    if (g.type === "tap") tap(g.at);
    else if (g.type === "wheel") {
      view = wheelZoom(view, fitScale(page, size.width, size.height), g.at, g.deltaY);
      moved = true;
    } else dragGesture(g);
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
    };
  };

  return {
    resize(width, height) {
      size = { width, height };
      if (!moved && width > 0 && height > 0) view = fitView(page, width, height);
    },
    gesture,
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
    undo() {
      const prev = finished ? undefined : undoStack.pop();
      if (!prev) return;
      drag = null;
      const from = state;
      redoStack.push(state);
      state = prev;
      settle(from);
    },
    redo() {
      const next = finished ? undefined : redoStack.pop();
      if (!next) return;
      drag = null;
      const from = state;
      undoStack.push(state);
      state = next;
      settle(from);
    },
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
    design() {
      if (designOf?.shapes !== state.shapes) {
        const closed = state.shapes.filter((s) => s.closed);
        // SVG space is y down: flip on the way out, as the loader flips back.
        const d = pathData(closed, ({ x, y }) => ({ x, y: -y }));
        designOf = { shapes: state.shapes, design: d ? options.toDesign(d) : null };
      }
      return designOf.design;
    },
    shapes: () => state.shapes,
    counts: () => ({
      points: state.shapes.reduce((n, s) => n + s.points.length, 0),
      open: state.shapes.filter((s) => !s.closed).length,
    }),
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
