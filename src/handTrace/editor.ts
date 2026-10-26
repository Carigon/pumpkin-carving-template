import type { BBox, Design, TemplateWarning } from "../core";
import { createEditor, type State } from "./context";
import type { XY } from "./curves";
import { createDispatch } from "./dispatch";
import { createEdits } from "./edits";
import type { Gesture, ScreenPoint } from "./gestures";
import { createHistory } from "./history";
import { createHits } from "./hits";
import { placeLoupe, type Loupe } from "./loupe";
import type { HandTraceRecord, Page, Point, Shape } from "./model";
import { loopsPathData, pathData } from "./pathData";
import { fitView, toScreen } from "./view";

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

/** The pill's hint when nothing is being drawn. */
const HINT = "Tap to place a point.";

export function createHandTrace<C = unknown>(options: HandTraceOptions<C>): HandTrace<C> {
  const ed = createEditor(options);
  const history = createHistory(ed, options.cleanup);
  const { committed, change, changeCleanup, undo, redo } = history;
  const hits = createHits(ed);
  const { knobs, markers, handleAt, tapAction } = hits;
  const edits = createEdits(ed, history, hits);
  const { placeAt, close, end, openEnd, carryOn, remove, toggleSymmetry, toggleSelected } = edits;
  const { gesture, key } = createDispatch(ed, history, hits, edits);
  /** The record last handed out, and what it was made from. */
  let recordOf: { state: State; finished: boolean; symmetry: boolean; record: HandTraceRecord } | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;
  /** The warnings last shown, and the Design they were for: once that changes, they're out of date. */
  let warnings: { design: Design | null; warnings: readonly TemplateWarning[] } | null = null;

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
