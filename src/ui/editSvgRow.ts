import { readSvgHandTrace, type SvgHandTrace } from "../input/svgHandTrace";

/** Above this many points, Edit as hand-trace warns that editing may be slow (a starting guess, to tune on phones). */
const MANY_POINTS = 2000;

export interface EditSvgRow {
  /** Show the row for the SVG design read from `svgText` (null: none is loaded). */
  show(svgText: string | null): void;
  /** The shown SVG design as a hand-trace: what Edit as hand-trace lands on; null with none. */
  edited(): SvgHandTrace | null;
}

/**
 * The Edit as hand-trace row, `row`: it shows for an SVG design with at least one shape, with a hint when it has a
 * great many points, and its button calls `onEdit`.
 */
export function mountEditSvgRow(row: HTMLElement, onEdit: () => void): EditSvgRow {
  const manyPoints = row.querySelector<HTMLElement>(".hint")!;
  let svgText: string | null = null;
  /** The shown SVG design as a hand-trace, worked out once per file. */
  let read: { of: string; handTrace: SvgHandTrace | null } | null = null;
  const edited = () => {
    if (svgText === null) return null;
    if (read?.of !== svgText) read = { of: svgText, handTrace: readSvgHandTrace(svgText) };
    return read.handTrace;
  };
  row.querySelector("button")!.addEventListener("click", onEdit);
  return {
    show(text) {
      svgText = text;
      const shapes = edited()?.handTrace.shapes ?? [];
      row.hidden = shapes.length === 0;
      manyPoints.hidden = shapes.reduce((n, s) => n + s.points.length, 0) <= MANY_POINTS;
    },
    edited,
  };
}
