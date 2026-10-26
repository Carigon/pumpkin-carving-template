import { carried } from "./carry";
import type { Editor, State } from "./context";
import type { HandTraceCleanup } from "./editor";
import type { Shape } from "./model";

/** Undo steps kept; older ones are dropped. */
const UNDO_LIMIT = 200;

/** The undo and redo steps as they stand, kept so a double-tap can put them back. */
export interface Steps {
  undo: State[];
  redo: State[];
}

/**
 * The undo history over `ed`'s states, with `cleanups` (when the points are over a photo) for carrying the shapes
 * through a cleanup change.
 */
export function createHistory<C>(ed: Editor, cleanups: HandTraceCleanup<C> | undefined) {
  const undoStack: State[] = [];
  let redoStack: State[] = [];
  /**
   * A run of live cleanup changes under way: the state before it, which every change in the run is carried from and
   * which the `Design` and the record still show; null with none.
   */
  let reframing: { from: State } | null = null;

  /** The state the `Design` and the record show: the one before a run of live cleanup changes, while there's one. */
  const committed = () => reframing?.from ?? ed.state;

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

  /**
   * After an undo or redo from `from`: keep the selection while its shape is still there with as many points, so
   * a point index still means the same point, and nothing is being drawn.
   */
  const settle = (from: State) => {
    const find = (shapes: readonly Shape[]) => ed.selection && shapes.find((s) => s.id === ed.selection?.shape);
    const [was, now] = [find(from.shapes), find(ed.state.shapes)];
    if (!was || !now || was.points.length !== now.points.length || ed.state.drawing !== null) ed.selection = null;
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

  return {
    committed,
    change,
    changeCleanup,
    endReframing,
    undo,
    redo,
    /** Which of undo and redo have a step to take. */
    can: () => ({ undo: undoStack.length > 0, redo: redoStack.length > 0 }),
    /** Copies of the undo and redo steps as they stand. */
    steps: (): Steps => ({ undo: [...undoStack], redo: [...redoStack] }),
    /** Put back steps `steps()` gave, as a double-tap taking its first tap back does. */
    restore: (steps: Steps) => {
      redoStack = [...steps.redo];
      undoStack.splice(0, undoStack.length, ...steps.undo);
    },
  };
}
