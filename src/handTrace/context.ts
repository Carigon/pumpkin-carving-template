import type { Side } from "./curves";
import type { HandTraceOptions } from "./editor";
import type { Knob } from "./hits";
import type { ScreenPoint } from "./gestures";
import type { Page, Point, Shape } from "./model";
import { shapesAsDrawn, type PointAsDrawn, type ShapeAsDrawn } from "./symmetry";
import { fitView, type ViewTransform } from "./view";

/** The shapes, which one is being drawn, and the page and cleanup they're over: what an undo step puts back. */
export interface State {
  shapes: readonly Shape[];
  drawing: number | null;
  page: Page;
  /** The cleanup under a photo, as the app keeps it; null without one. */
  cleanup: unknown;
}

/**
 * What's selected: one point (by its shape and index, as placed or `reflected`), with one of its handles as drawn
 * (`handle`, for the arrow keys) or not, or one shape (touched on its reflection or not). Selecting isn't an undo
 * step.
 */
export type Selection =
  | { kind: "point"; shape: number; index: number; reflected?: true; handle?: Side }
  | { kind: "shape"; shape: number; reflected?: true };

/**
 * A drag or hold under way: a pan from the view it started at; a move of one point (`index`) or of a whole shape
 * (`index` null), by its reflection or not; a handle or stub dragged (`alone` with Alt held); aiming the loupe at
 * where a point will be placed, the finger `at`; or a hold that's waiting to be a tap or a drag. A move or handle
 * drag is shown as `live` and kept out of the shapes until it ends, as one undo step; `selection` is what was
 * selected before, put back if the drag is cancelled; `loupe` says it's by touch. `snapped` while the point is held
 * on the axis.
 */
export type Drag =
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

/**
 * What the editor's parts share between calls: the shapes and the page they're on, how the page sits on the canvas,
 * what's selected, dragged or hovered over, and the settings. Each part reads and changes it in place.
 */
export interface Editor {
  state: State;
  /** The page the points are placed on now: the state's. */
  page: Page;
  /** The symmetry axis: a vertical line down the page's middle, as its x. */
  axis: number;
  /** The canvas's size in px. */
  size: { width: number; height: number };
  view: ViewTransform;
  /** The carver has panned or zoomed, so a resize keeps the view. */
  moved: boolean;
  selection: Selection | null;
  drag: Drag | null;
  /** Where a mouse or pen hovers, and whether a press there pans (Space held); null once it has left. */
  pointer: { at: ScreenPoint; pans: boolean } | null;
  /** The id the next new shape gets. */
  nextId: number;
  /** Done was pressed (and not Edit since). */
  finished: boolean;
  /** The Symmetry setting: shapes started while it's on are mirrored. */
  symmetry: boolean;
  /** Put `next` in place: a new page brings its own axis, and refits the view unless the carver has moved it. */
  setState(next: State): void;
  /** The shapes `shape` is drawn as, worked out once per shape and axis: shapes are never changed in place. */
  asDrawn(shape: Shape): ShapeAsDrawn[];
  /**
   * Where `shape`'s point `index` is drawn, as placed or `reflected`: its shape as drawn (`o`), the point there and
   * its place (`k`) and position. A symmetric shape's end on the axis is one point as drawn, whichever copy is asked
   * for.
   */
  findAsDrawn(shape: Shape, index: number, reflected: boolean): AsDrawn | null;
  /** The shape being drawn, if there is one. */
  drawingShape(): Shape | null;
  /** The shapes with `shape` in place of the one with its id. */
  replace(shape: Shape): readonly Shape[];
}

/** One point where it's drawn: see `Editor.findAsDrawn`. */
interface AsDrawn {
  shapeAsDrawn: ShapeAsDrawn;
  o: number;
  k: number;
  pointAsDrawn: PointAsDrawn;
  at: Point;
}

/** A blank page: square, with points relative to its size. */
const BLANK_PAGE: Page = { width: 1, height: 1 };

/** The editor's working state to begin with: the stored record reopened, if there is one, on its page. */
export function createEditor<C>(options: HandTraceOptions<C>): Editor {
  const cleanups = options.cleanup;
  const reopened = options.record;
  const state: State = {
    shapes: reopened?.shapes ?? [],
    drawing: reopened?.drawing ?? null,
    page: cleanups ? cleanups.page(cleanups.start) : (options.page ?? BLANK_PAGE),
    cleanup: cleanups ? cleanups.start : null,
  };
  const asDrawnCache = new WeakMap<Shape, { axis: number; asDrawn: ShapeAsDrawn[] }>();
  const ed: Editor = {
    state,
    page: state.page,
    axis: state.page.width / 2,
    size: { width: 0, height: 0 },
    view: fitView(state.page, 1, 1),
    moved: false,
    selection: null,
    drag: null,
    pointer: null,
    nextId: Math.max(0, ...state.shapes.map((s) => s.id)) + 1,
    finished: reopened?.done ?? false,
    symmetry: reopened?.symmetry ?? false,
    setState(next) {
      ed.state = next;
      if (next.page === ed.page) return;
      ed.page = next.page;
      ed.axis = ed.page.width / 2;
      if (!ed.moved && ed.size.width > 0 && ed.size.height > 0) ed.view = fitView(ed.page, ed.size.width, ed.size.height);
    },
    asDrawn(shape) {
      const known = asDrawnCache.get(shape);
      if (known?.axis === ed.axis) return known.asDrawn;
      const made = shapesAsDrawn(shape, ed.axis);
      asDrawnCache.set(shape, { axis: ed.axis, asDrawn: made });
      return made;
    },
    findAsDrawn(shape, index, reflected) {
      const all = ed.asDrawn(shape).flatMap((shapeAsDrawn, o) =>
        shapeAsDrawn.pointsAsDrawn.map((pointAsDrawn, k) => ({ shapeAsDrawn, o, k, pointAsDrawn, at: shapeAsDrawn.shape.points[k] })),
      );
      const exact = all.find((n) => n.pointAsDrawn.index === index && n.pointAsDrawn.reflected === reflected);
      return exact ?? all.find((n) => n.pointAsDrawn.index === index) ?? null;
    },
    drawingShape: () => ed.state.shapes.find((s) => s.id === ed.state.drawing) ?? null,
    replace: (shape) => ed.state.shapes.map((s) => (s.id === shape.id ? shape : s)),
  };
  return ed;
}

/** `{ reflected: true }` for a reflection, nothing otherwise: how a selection says which copy was picked. */
export const copy = (reflected: boolean) => (reflected ? { reflected: true as const } : {});
