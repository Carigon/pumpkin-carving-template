import type { Design, TemplateWarning } from "../core";
import { createEditor } from "./context";
import type { XY } from "./curves";
import { createDispatch } from "./dispatch";
import { createDrawn, type Drawn } from "./drawn";
import { createEdits } from "./edits";
import type { Gesture } from "./gestures";
import { createHistory } from "./history";
import { createHits } from "./hits";
import type { HandTraceRecord, Page, Shape } from "./model";
import { createOutput, type ShapePaths } from "./output";
import { fitView } from "./view";

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
 * The hand-trace editor, put together from its parts: the working state they share, the undo history, the hit tests,
 * the edit rules, the gesture and key dispatch, what's drawn, and what comes out for the app to keep.
 */
export function createHandTrace<C = unknown>(options: HandTraceOptions<C>): HandTrace<C> {
  const ed = createEditor(options);
  const history = createHistory(ed, options.cleanup);
  const hits = createHits(ed);
  const edits = createEdits(ed, history, hits);
  const output = createOutput(ed, options, history);
  const { drawn, showWarnings } = createDrawn(ed, options, history, hits, edits, output);
  const { gesture, key } = createDispatch(ed, history, hits, edits);
  const { change } = history;
  const { close, end, remove, carryOn, toggleSelected, toggleSymmetry } = edits;

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
    undo: history.undo,
    redo: history.redo,
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
    design: output.design,
    pathData: output.pathData,
    shapePaths: output.shapePaths,
    shapes: () => ed.state.shapes,
    record: output.record,
    page: () => ed.page,
    changeCleanup: history.changeCleanup,
    cleanup: () => ed.state.cleanup as C | null,
    counts: () => ({
      points: ed.state.shapes.reduce((n, s) => n + s.points.length, 0),
      open: ed.state.shapes.filter((s) => !s.closed).length,
    }),
    showWarnings,
  };
}
