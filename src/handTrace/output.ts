import type { Design } from "../core";
import type { Editor, State } from "./context";
import type { XY } from "./curves";
import type { HandTraceOptions } from "./editor";
import type { History } from "./history";
import type { HandTraceRecord, Shape } from "./model";
import { pathData } from "./pathData";

/** Shapes and their reflections as path data, the closed ones apart from the open ones. */
export interface ShapePaths {
  closed: string;
  open: string;
}

/** What comes out of the editor for the app to keep. */
export type Output = ReturnType<typeof createOutput>;

/**
 * What the app keeps of `ed`'s shapes: the `Design`, the path data it and a hand-trace file are made from, what
 * Cleanup draws, and the stored record. The `Design` and the record show `history`'s committed state, so a live
 * cleanup change stays out of them.
 */
export function createOutput(ed: Editor, options: Pick<HandTraceOptions, "toDesign">, history: Pick<History, "committed">) {
  const { committed } = history;
  /** The record last handed out, and what it was made from. */
  let recordOf: { state: State; finished: boolean; symmetry: boolean; record: HandTraceRecord } | null = null;
  /** The shapes `design` was last worked out from, and the result. */
  let designOf: { shapes: readonly Shape[]; design: Design | null } | null = null;

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

  const shapePaths = (map: (p: XY) => XY): ShapePaths => ({
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
  });

  const record = (): HandTraceRecord => {
    const shown = committed();
    if (recordOf?.state !== shown || recordOf.finished !== ed.finished || recordOf.symmetry !== ed.symmetry) {
      const record = { shapes: [...shown.shapes], drawing: shown.drawing, done: ed.finished, ...(ed.symmetry && { symmetry: ed.symmetry }) };
      recordOf = { state: shown, finished: ed.finished, symmetry: ed.symmetry, record };
    }
    return recordOf.record;
  };

  return { design, pathData: closedPathData, shapePaths, record };
}

/** `design` with its box widened evenly about the axis at x = `axis`, so the axis is its middle. */
function aboutAxis(design: Design, axis: number): Design {
  const half = Math.max(axis - design.bbox.minX, design.bbox.maxX - axis);
  return { ...design, bbox: { ...design.bbox, minX: axis - half, maxX: axis + half } };
}
