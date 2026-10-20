import type { TemplateWarning } from "./core";
import type { RingId } from "./ringEdits";

/** The measurement warnings as the Measure form shows them: under the Height, under the table, or on a ring's row. */
export interface PlacedWarnings {
  height: string[];
  /** About the rings as a whole, with no row to blame. */
  table: string[];
  /** Every shown ring's row, by id (empty when it has none). */
  rings: Map<RingId, string[]>;
}

/** A failed fit blamed on the ring edited last, which `ring` names ("this ring", "the ring at 6 ½ in"). */
export function blamedFitMessage(ring: string): string {
  return `No smooth pumpkin shape passes through ${ring}. Check its height and circumference.`;
}

/** On the row of the ring edited last, a failed fit's warning names that ring. */
const BLAMED = blamedFitMessage("this ring");

/**
 * Where each impossible-measurement warning goes. A ring's own warning goes on its row: its index is into
 * `rings`, the ids of the measurements checked, in order. A failed fit can't tell which ring is to blame, so it
 * goes on the row of the ring edited last (`edited`), or under the table when that ring isn't shown or nothing has
 * been edited since the page loaded.
 */
export function placeMeasureWarnings(warnings: TemplateWarning[], rings: RingId[], edited: RingId | null): PlacedWarnings {
  const placed: PlacedWarnings = { height: [], table: [], rings: new Map(rings.map((id) => [id, []])) };
  for (const w of warnings) {
    if (w.kind !== "impossible-measurement") continue;
    if (w.field === "height") placed.height.push(w.message);
    else if (w.ring !== undefined) placed.rings.get(rings[w.ring])?.push(w.message);
    else if (edited !== null && placed.rings.has(edited)) placed.rings.get(edited)!.push(BLAMED);
    else placed.table.push(w.message);
  }
  return placed;
}
