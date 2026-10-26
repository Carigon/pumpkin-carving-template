import type { TemplateWarning, Units } from "../core";
import { formatLength } from "../displayUnits";
import { counted } from "./counted";

/** Which panel shows each kind of warning (measurement warnings sit next to their own field instead). */
const WARNING_PANEL: Record<TemplateWarning["kind"], "measurements" | "design" | "slits"> = {
  "impossible-measurement": "measurements",
  "outside-silhouette": "design",
  "past-front-limit": "design",
  crossing: "design",
  "floating-piece": "design",
  "tiny-carve-area": "design",
  "slits-dont-fit": "slits",
  "slit-limit": "slits",
};

/** Warnings about shapes that won't carve well, which the core leaves for the UI to word. */
type ShapeWarning = Extract<TemplateWarning, { kind: "crossing" | "floating-piece" | "tiny-carve-area" }>;

/** Is this a warning about a shape that won't carve well (a crossing, floating piece or tiny carve area)? */
export function isShapeWarning(w: TemplateWarning): w is ShapeWarning {
  return w.kind === "crossing" || w.kind === "floating-piece" || w.kind === "tiny-carve-area";
}

/** What the Design panel's lines depend on beyond the warnings. */
export interface DesignWarningContext {
  units: Units;
  /**
   * Where the design comes from: an image's auto-trace result (tiny carve areas are likely specks), an SVG design
   * (fixed by editing it as a hand-trace) or a hand-trace.
   */
  source: "auto-trace" | "svg" | "hand-trace";
}

/** The hint on an SVG design's shape warnings: Edit as hand-trace is how to fix them here. */
const EDIT_HINT = "Edit it as a hand-trace to fix this.";

/**
 * A warning's line in the Design panel: shape warnings worded with their count, in the display units, with a hint
 * for the design's source.
 */
export function designWarningText(w: TemplateWarning, { units, source }: DesignWarningContext): string {
  if (!isShapeWarning(w)) return w.message;
  const line = shapeWarningText(w, units, source === "auto-trace");
  return source === "svg" ? `${line} ${EDIT_HINT}` : line;
}

function shapeWarningText(w: ShapeWarning, units: Units, autoTrace: boolean): string {
  switch (w.kind) {
    case "crossing": {
      const n = w.at.length;
      return `${counted(n, "place")} where edges cross. The overlap isn't carved and may break away.`;
    }
    case "floating-piece": {
      const n = w.pieces.length;
      return n === 1
        ? "1 floating piece of pumpkin: nothing holds it once its surroundings are cut, so it will fall out. Leave a bridge to the rest."
        : `${n} floating pieces of pumpkin: nothing holds them once their surroundings are cut, so they will fall out. Leave a bridge to the rest.`;
    }
    case "tiny-carve-area": {
      const n = w.areas.length;
      const size = formatLength(w.minSizeMm, units);
      const line = `${counted(n, "carve area is", "carve areas are")} smaller than ${size} across and will be hard to cut.`;
      return autoTrace ? `${line} Raise Speckle removal.` : line;
    }
  }
}

/** Show the warnings that belong to `panel` in `el`, one block each, worded by `text`. */
export function renderWarnings(
  el: HTMLElement,
  warnings: TemplateWarning[],
  panel: "design" | "slits",
  text: (w: TemplateWarning) => string = (w) => ("message" in w ? w.message : ""),
): void {
  el.replaceChildren(
    ...warnings
      .filter((w) => WARNING_PANEL[w.kind] === panel)
      .map((w) => {
        const div = document.createElement("div");
        div.className = "warning";
        div.dataset.kind = w.kind;
        div.textContent = text(w);
        return div;
      }),
  );
}
