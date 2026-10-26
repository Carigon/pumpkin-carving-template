import type { Design } from "../core";
import type { Gesture, ScreenPoint } from "./gestures";
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
}

/** One point as drawn. */
export interface DrawnPoint {
  at: ScreenPoint;
  kind: Point["kind"];
  /** One of an open shape's two end points, marked so the carver sees it isn't closed. */
  end: boolean;
  /** The first point of the shape being drawn, once a tap on it would close the shape. */
  closable: boolean;
}

/** What the floating pill offers: the point count with Close and End while drawing, otherwise a hint. */
export type Pill = { kind: "drawing"; points: number; canClose: boolean } | { kind: "hint"; text: string };

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

/** Screen radius (px) within which a tap hits a point, whatever the zoom. */
const HIT_RADIUS_PX = 22;
/** Undo steps kept; older ones are dropped. */
const UNDO_LIMIT = 200;
/** The pill's hint when nothing is being drawn. */
const HINT = "Tap to place a point.";

/** The shapes and which one is being drawn: what an undo step puts back. */
interface State {
  shapes: readonly Shape[];
  drawing: number | null;
}

/** A point hit by a tap: its shape and index. */
interface Hit {
  shape: Shape;
  index: number;
}

/** A blank page: square, with points relative to its size. */
const BLANK_PAGE: Page = { width: 1, height: 1 };

export function createHandTrace(options: HandTraceOptions): HandTrace {
  const page = options.page ?? BLANK_PAGE;
  let state: State = { shapes: [], drawing: null };
  const undoStack: State[] = [];
  let redoStack: State[] = [];
  let nextId = 1;
  let finished = false;
  let size = { width: 0, height: 0 };
  let view: ViewTransform = fitView(page, 1, 1);
  /** The carver has panned or zoomed, so a resize keeps the view. */
  let moved = false;
  /** The view a pan started from. */
  let panFrom: ViewTransform | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;

  const drawingShape = () => state.shapes.find((s) => s.id === state.drawing) ?? null;

  /** Make a change to the shapes, as one undo step. */
  const change = (next: State) => {
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

  /** The nearest point within the hit radius, the shape being drawn winning ties. */
  const hitTest = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    const order = [...state.shapes].sort((a, b) => Number(b.id === state.drawing) - Number(a.id === state.drawing));
    for (const shape of order) {
      shape.points.forEach((p, index) => {
        const s = toScreen(view, p);
        const d = Math.hypot(s.x - at.x, s.y - at.y);
        if (d < bestDistance) [best, bestDistance] = [{ shape, index }, d];
      });
    }
    return best;
  };

  /** What a tap does, by what's under it and whether a shape is being drawn. */
  const tap = (at: ScreenPoint) => {
    const hit = hitTest(at);
    const shape = drawingShape();
    if (!hit) return place(at);
    if (!shape || hit.shape.id !== shape.id) return end();
    const last = shape.points.length - 1;
    if (hit.index === last) end();
    else if (hit.index === 0) close();
    else place(at);
  };

  const gesture = (g: Gesture) => {
    if (finished || size.width === 0) return;
    if (g.type === "tap") tap(g.at);
    else if (g.type === "wheel") {
      view = wheelZoom(view, fitScale(page, size.width, size.height), g.at, g.deltaY);
      moved = true;
    } else {
      if (g.phase === "start") panFrom = view;
      if (!panFrom) return;
      view = { ...panFrom, tx: panFrom.tx + g.at.x - g.from.x, ty: panFrom.ty + g.at.y - g.from.y };
      moved = true;
      if (g.phase === "end" || g.phase === "cancel") panFrom = null;
    }
  };

  const drawn = (): Drawn => {
    const screen = (p: { x: number; y: number }) => toScreen(view, p);
    const corner = screen({ x: 0, y: page.height });
    const shape = drawingShape();
    const open = state.shapes.filter((s) => !s.closed).length;
    return {
      page: { ...corner, width: page.width * view.scale, height: page.height * view.scale },
      axis: { from: screen({ x: page.width / 2, y: page.height }), to: screen({ x: page.width / 2, y: 0 }) },
      fill: pathData(
        state.shapes.filter((s) => s.closed),
        screen,
      ),
      shapes: state.shapes.map((s) => ({
        id: s.id,
        d: pathData([s], screen),
        closed: s.closed,
        drawing: s.id === state.drawing,
      })),
      points: state.shapes.flatMap((s) =>
        s.points.map((p, i) => ({
          at: screen(p),
          kind: p.kind,
          end: !s.closed && (i === 0 || i === s.points.length - 1),
          closable: s.id === state.drawing && i === 0 && s.points.length >= 3,
        })),
      ),
      pill: shape
        ? { kind: "drawing", points: shape.points.length, canClose: shape.points.length >= 3 }
        : { kind: "hint", text: HINT },
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
    clear() {
      if (!finished && state.shapes.length > 0) change({ shapes: [], drawing: null });
    },
    undo() {
      const prev = finished ? undefined : undoStack.pop();
      if (!prev) return;
      redoStack.push(state);
      state = prev;
    },
    redo() {
      const next = finished ? undefined : redoStack.pop();
      if (!next) return;
      undoStack.push(state);
      state = next;
    },
    done() {
      end();
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
