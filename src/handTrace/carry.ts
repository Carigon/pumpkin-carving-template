/**
 * Carrying a hand-trace's shapes through a cleanup change (spec #27, "Through a cleanup change"; ADR 0003): every
 * point, and every stored handle's tip, taken where the change takes its spot. Exact for crop, rotate, Turn and
 * aspect changes, which are affine in design space; under a four-corner change straight edges stay exact and curves
 * are approximated, silently. Gives new shapes; nothing is changed in place.
 */
import type { XY } from "./curves";
import type { Offset, Point, Shape } from "./model";
import { editMirrored, keptToSide, onAxis, sideOf } from "./symmetry";

/**
 * `shape` with its positions taken through `map`. A stored handle's tip is mapped and its offset worked out again;
 * a smooth point's two stored handles then share the average of their mapped directions, keeping their lengths, so
 * it stays smooth. Automatic handles aren't stored, so they're recomputed from the carried points. A mirrored
 * shape's points stay on its side of the axis at x = `axis` (a point landing on it is put on it exactly), and a
 * symmetric shape's smooth ends on the axis keep their handles level. Points landing off the page stay where they
 * fall.
 */
export function carried(shape: Shape, map: (p: XY) => XY, axis: number): Shape {
  const points = shape.points.map((p) => carriedPoint(p, map));
  if (shape.mirror === "none") return { ...shape, points };
  const moved = { ...shape, points };
  const side = sideOf(moved, axis);
  const kept = points.map((p) => ({ ...p, x: onAxis(p, axis) ? axis : keptToSide(p.x, side, axis) }));
  return editMirrored({ ...shape, points: kept }, axis, [], (s) => s);
}

function carriedPoint(p: Point, map: (p: XY) => XY): Point {
  const at = map(p);
  const tip = (h: Offset | undefined) => {
    if (!h) return undefined;
    const t = map({ x: p.x + h.x, y: p.y + h.y });
    return { x: t.x - at.x, y: t.y - at.y };
  };
  let [hin, hout] = [tip(p.in), tip(p.out)];
  if (p.kind === "smooth" && hin && hout) {
    const [a, b] = [Math.hypot(hin.x, hin.y), Math.hypot(hout.x, hout.y)];
    const dx = hout.x / b - hin.x / a;
    const dy = hout.y / b - hin.y / a;
    const d = Math.hypot(dx, dy);
    if (d > 0) [hin, hout] = [{ x: (-dx / d) * a, y: (-dy / d) * a }, { x: (dx / d) * b, y: (dy / d) * b }];
  }
  return { x: at.x, y: at.y, kind: p.kind, ...(hin && { in: hin }), ...(hout && { out: hout }) };
}
