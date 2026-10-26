import type { BBox, Design, TemplateWarning } from "../core";
import type { Editor } from "./context";
import type { Edits } from "./edits";
import type { HandTraceOptions } from "./editor";
import type { ScreenPoint } from "./gestures";
import type { History } from "./history";
import type { Hits } from "./hits";
import { placeLoupe, type Loupe } from "./loupe";
import type { Point, Shape } from "./model";
import type { Output } from "./output";
import { loopsPathData, pathData } from "./pathData";
import { toScreen } from "./view";

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

/** The pill's hint when nothing is being drawn. */
const HINT = "Tap to place a point.";

/**
 * What `ed`'s canvas shows, in screen coordinates: the page, the shapes and their points and handles, the pill, the
 * marks for the shape warnings last shown for `output`'s Design, the loupe and the hover.
 */
export function createDrawn(
  ed: Editor,
  options: Pick<HandTraceOptions, "photo">,
  history: Pick<History, "can">,
  hits: Hits,
  edits: Edits,
  output: Pick<Output, "design">,
) {
  const { knobs, markers, handleAt, tapAction } = hits;
  const { placeAt, openEnd } = edits;
  const { design } = output;
  /** The warnings last shown, and the Design they were for: once that changes, they're out of date. */
  let warnings: { design: Design | null; warnings: readonly TemplateWarning[] } | null = null;

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

  /** The core's warnings for the Design: its shape warnings are marked where they are. */
  const showWarnings = (next: readonly TemplateWarning[]) => {
    warnings = { design: design(), warnings: next };
  };

  return { drawn, showWarnings };
}
