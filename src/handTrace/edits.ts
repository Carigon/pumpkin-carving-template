import { signedArea } from "../core";
import type { Editor, Selection, State } from "./context";
import { edgePolyline, edgesOf, split, toggleKind, withHandle, withoutPoint, type XY } from "./curves";
import type { ScreenPoint } from "./gestures";
import type { History } from "./history";
import { CURVE_PIECES, HIT_RADIUS_PX, type Hits, type Knob, type Marker } from "./hits";
import type { Page, Point, Shape } from "./model";
import { actingHandle, closed, editMirrored, keptToSide, mirrorOffset, onAxis, sideOf } from "./symmetry";
import { toDesignSpace } from "./view";

/** How many hit radii a snapped point is dragged off the axis before it lets go: clearly past the snap. */
const SNAP_RELEASE = 1.5;
/** A handle dragged this close (screen px) to its point is removed. */
const RETRACT_PX = 10;
/** A symmetric shape enclosing no more than this, as a fraction of the page's area, encloses none: it's deleted. */
const NO_AREA = 1e-12;

/** The edit rules on `ed`'s shapes; each change is one undo step in `history`. */
export function createEdits(ed: Editor, history: Pick<History, "change">, hits: Pick<Hits, "knobs">) {
  const { change } = history;
  const { knobs } = hits;
  /**
   * The shapes and selection the last arrow nudge left. While both are still those (nothing else has changed or
   * selected since), the next nudge joins its undo step: a run of presses is one step.
   */
  let nudged: { state: State; selection: Selection } | null = null;

  /**
   * Design-space position `p` clamped to the page, and for a point of mirrored `shape` (its point `skip` the one
   * moving) kept to the shape's side of the axis.
   */
  const keep = (p: XY, shape: Shape | null, skip = -1): XY => {
    const x = Math.min(ed.page.width, Math.max(0, p.x));
    const y = Math.min(ed.page.height, Math.max(0, p.y));
    return { x: shape && shape.mirror !== "none" ? keptToSide(x, sideOf(shape, ed.axis, skip), ed.axis) : x, y };
  };

  /**
   * `p` kept (as `keep` does) and, for a point of a mirrored shape being drawn or dragged, snapped onto the axis
   * within the hit radius, or the wider release distance while `held` there already. `snapped` once it's on the axis.
   */
  const constrain = (p: XY, shape: Shape | null, mirrored: boolean, skip = -1, held = false) => {
    const x = Math.min(ed.page.width, Math.max(0, p.x));
    const near = mirrored && Math.abs(x - ed.axis) * ed.view.scale < HIT_RADIUS_PX * (held ? SNAP_RELEASE : 1);
    const q = keep({ x: near ? ed.axis : x, y: p.y }, mirrored ? shape : null, skip);
    return { ...q, snapped: mirrored && q.x === ed.axis };
  };

  /** Whether a point placed now is a mirrored shape's: the shape being drawn's, or (with none) a new one's. */
  const placingMirrored = () => {
    const shape = ed.drawingShape();
    return shape ? shape.mirror !== "none" : ed.symmetry;
  };

  /** A screen position as a point placed on the page: clamped to it; for a mirrored shape, snapped and kept to its side. */
  const placeAt = (at: ScreenPoint, held = false): { point: Point; snapped: boolean } => {
    const { x, y, snapped } = constrain(toDesignSpace(ed.view, at), ed.drawingShape(), placingMirrored(), -1, held);
    return { point: { x, y, kind: "corner" }, snapped };
  };

  /**
   * Place a point (`held` on the axis already, as a hold aims): on the shape being drawn, or starting one. A mirrored
   * shape started on the axis closes by itself as it lands on the axis again, with points off it to mirror.
   */
  const place = (at: ScreenPoint, held = false) => {
    const { point } = placeAt(at, held);
    const shape = ed.drawingShape();
    if (shape) {
      const grown = { ...shape, points: [...shape.points, point] };
      const on = (p: XY) => onAxis(p, ed.axis);
      const lands = shape.mirror !== "none" && on(point) && on(shape.points[0]) && grown.points.length >= 3;
      if (lands && !grown.points.every(on)) change({ ...ed.state, shapes: ed.replace(closed(grown, ed.axis)), drawing: null });
      else change({ ...ed.state, shapes: ed.replace(grown) });
    } else {
      const id = ed.nextId++;
      const mirror = ed.symmetry ? "twin" : "none";
      change({ ...ed.state, shapes: [...ed.state.shapes, { id, closed: false, mirror, points: [point] }], drawing: id });
    }
  };

  const close = () => {
    const shape = ed.drawingShape();
    if (!shape || shape.points.length < 3) return;
    change({ ...ed.state, shapes: ed.replace(closed(shape, ed.axis)), drawing: null });
  };

  const end = () => {
    if (ed.state.drawing !== null) ed.state = { ...ed.state, drawing: null };
  };

  /** The selected point's shape, if the point is one of an open shape's two ends. */
  const openEnd = (): Shape | null => {
    if (ed.selection?.kind !== "point") return null;
    const { shape: id, index } = ed.selection;
    const shape = ed.state.shapes.find((s) => s.id === id);
    return shape && !shape.closed && (index === 0 || index === shape.points.length - 1) ? shape : null;
  };

  const carryOn = () => {
    const shape = openEnd();
    if (!shape) return;
    // Drawing always adds at the last point, so carrying on from the first turns the shape round.
    const turned = ed.selection?.kind === "point" && ed.selection.index === 0 && shape.points.length > 1;
    const shapes = turned ? ed.replace({ ...shape, points: [...shape.points].reverse() }) : ed.state.shapes;
    ed.state = { ...ed.state, shapes, drawing: shape.id };
    ed.selection = null;
    ed.drag = null;
  };

  /**
   * Whether closed `shape` is too small to keep: under 3 points, or for a symmetric shape, counted whole, under 3
   * distinct points or enclosing no area.
   */
  const tooSmall = (shape: Shape): boolean => {
    if (shape.mirror !== "symmetric") return shape.points.length < 3;
    const [whole] = ed.asDrawn(shape);
    const poly = edgesOf(whole.shape).flatMap((e) => edgePolyline(e, CURVE_PIECES).slice(1));
    return whole.pointsAsDrawn.length < 3 || Math.abs(signedArea(poly)) <= NO_AREA * ed.page.width * ed.page.height;
  };

  /** Delete the selected point (its source, if it's on a reflection) or shape, and a shape the point leaves too small. */
  const remove = () => {
    const picked = ed.selection;
    const shape = picked && ed.state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    const i = picked.kind === "point" ? picked.index : -1;
    const left = i >= 0 ? editMirrored(shape, ed.axis, [i - 1, i, i + 1], (s) => withoutPoint(s, i)) : { ...shape, points: [] };
    const gone = left.points.length === 0 || (shape.closed && tooSmall(left));
    const shapes = gone ? ed.state.shapes.filter((s) => s !== shape) : ed.replace(left);
    change({ ...ed.state, shapes });
    ed.selection = null;
  };

  /**
   * `marker`'s shape with a corner point added at the marker (keeping its edge where it was, and its side of the axis), the
   * new point's index, and whether it's drawn under the marker on the reflection. On a symmetric shape's join across
   * the axis, it's a new end on the axis, and the old end, now between, keeps the straight join as a corner.
   */
  const insert = ({ shape, insert: how, at, reflected }: Marker): { shape: Shape; index: number; reflected: boolean } => {
    if ("join" in how) {
      const last = shape.points.length - 1;
      const [i, own] = how.join === "end" ? [last, "in" as const] : [0, "out" as const];
      const h = actingHandle(shape, ed.axis, i, own);
      const between: Point = { x: shape.points[i].x, y: shape.points[i].y, kind: "corner", ...(h && { [own]: h }) };
      const end: Point = { x: ed.axis, y: at.y, kind: "corner" };
      const rest = how.join === "end" ? shape.points.slice(0, last) : shape.points.slice(1);
      const points = how.join === "end" ? [...rest, between, end] : [end, between, ...rest];
      return { shape: { ...shape, points }, index: how.join === "end" ? last + 1 : 0, reflected: false };
    }
    let index = 0;
    const next = editMirrored(shape, ed.axis, [how.after, how.after + 1], (plain) => {
      const done = split(plain, how.after);
      index = done.index;
      return done.shape;
    });
    const p = next.points[index];
    const x = keep(p, next, index).x;
    const points = next.points.map((q, i) => (i === index ? { ...q, x } : q));
    return { shape: { ...next, points }, index, reflected: reflected && !onAxis({ x, y: p.y }, ed.axis) };
  };

  const toggleSymmetry = () => {
    ed.symmetry = !ed.symmetry;
  };

  /** `shape` with its point `index` switched between smooth and corner. */
  const toggled = (shape: Shape, index: number) => editMirrored(shape, ed.axis, [index], (s) => toggleKind(s, index));

  /** Smooth / Corner on the selected point. */
  const toggleSelected = () => {
    const picked = ed.selection?.kind === "point" ? ed.selection : null;
    const shape = picked && ed.state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return;
    change({ ...ed.state, shapes: ed.replace(toggled(shape, picked.index)) });
  };

  /**
   * `shape` with the handle on `side` of its point as drawn `knob` set to design-space `offset` as drawn, or (null)
   * removed (as it is within `RETRACT_PX` of its point, when it `retracts`): the shape's own handle, mirrored back
   * when it's drawn on a reflection (a smooth end on the axis then levels it, as every edit does).
   */
  const withKnob = (knob: Knob, offset: XY, alone: boolean, retracts = true): Shape => {
    const { shape, pointAsDrawn, source } = knob;
    const own = source.mirrored ? mirrorOffset(offset) : offset;
    const short = Math.hypot(own.x, own.y) * ed.view.scale < (retracts ? RETRACT_PX : 1e-9);
    const kept = short ? null : own;
    return editMirrored(shape, ed.axis, [pointAsDrawn.index], (s) => withHandle(s, pointAsDrawn.index, source.side, kept, alone));
  };

  /**
   * `start` with its point `index` moved by design-space `delta` (or, with `index` null, the whole shape), kept on
   * the page and to its side of the axis; a mirrored shape's point snaps onto the axis (`held`: it was snapped).
   * A delta from a drag on the reflection is mirrored first, so the reflection follows the finger.
   */
  const movedBy = (start: Shape, index: number | null, delta: XY, reflected: boolean, held: boolean) => {
    const by = reflected ? mirrorOffset(delta) : delta;
    if (index === null) return { shape: moveWhole(start, by, ed.page, ed.axis), snapped: false };
    const p = start.points[index];
    const c = constrain({ x: p.x + by.x, y: p.y + by.y }, start, start.mirror !== "none", index, held);
    const points = start.points.map((q, i) => (i === index ? { ...q, x: c.x, y: c.y } : q));
    return { shape: { ...start, points }, snapped: c.snapped };
  };

  /**
   * Nudge the selected handle, point or shape `by` screen px, the way the arrow points where it's drawn (on a
   * reflection too); a run of nudges is one undo step.
   */
  const nudge = (by: { x: number; y: number }): boolean => {
    const picked = ed.selection;
    const shape = picked && ed.state.shapes.find((s) => s.id === picked.shape);
    if (!picked || !shape) return false;
    const delta = { x: by.x / ed.view.scale, y: -by.y / ed.view.scale };
    const reflected = !!picked.reflected;
    let next: Shape;
    const handle = picked.kind === "point" ? picked.handle : undefined;
    const knob = handle && knobs(ed.state.shapes).find((h) => h.role === "own" && !h.stub && h.side === handle);
    if (knob) {
      const offset = { x: knob.tip.x - knob.base.x + delta.x, y: knob.tip.y - knob.base.y + delta.y };
      next = withKnob(knob, offset, false, false);
    } else if (picked.kind === "point") {
      const p = shape.points[picked.index];
      const by = reflected ? mirrorOffset(delta) : delta;
      const q = keep({ x: p.x + by.x, y: p.y + by.y }, shape, picked.index);
      next = { ...shape, points: shape.points.map((r, i) => (i === picked.index ? { ...r, ...q } : r)) };
    } else next = moveWhole(shape, reflected ? mirrorOffset(delta) : delta, ed.page, ed.axis);
    const same = JSON.stringify(next) === JSON.stringify(shape);
    if (same) return true;
    const after = { ...ed.state, shapes: ed.replace(next) };
    if (nudged?.state === ed.state && nudged.selection === picked) ed.state = after;
    else change(after);
    nudged = { state: ed.state, selection: picked };
    return true;
  };

  /** Backspace while drawing with nothing selected: take off the last point placed, and the shape with its only one. */
  const removeLast = () => {
    const shape = ed.drawingShape()!;
    const points = shape.points.slice(0, -1);
    if (points.length > 0) change({ ...ed.state, shapes: ed.replace({ ...shape, points }) });
    else change({ ...ed.state, shapes: ed.state.shapes.filter((s) => s !== shape), drawing: null });
  };

  return {
    placeAt,
    place,
    close,
    end,
    openEnd,
    carryOn,
    remove,
    insert,
    toggleSymmetry,
    toggled,
    toggleSelected,
    withKnob,
    movedBy,
    nudge,
    removeLast,
  };
}

/**
 * `shape` moved whole by `delta`, kept on `page`: it stops at the page's edge rather than squashing against it (one
 * already over the edge, imported, can still move back). A twin stops at the axis, on its side; a symmetric shape,
 * centred on the axis, moves only up and down.
 */
function moveWhole(shape: Shape, delta: { x: number; y: number }, page: Page, axis: number): Shape {
  const stop = (d: number, values: number[], max: number) =>
    Math.min(Math.max(0, max - Math.max(...values)), Math.max(Math.min(0, -Math.min(...values)), d));
  const xs = shape.points.map((p) => p.x);
  let dx = shape.mirror === "symmetric" ? 0 : stop(delta.x, xs, page.width);
  const side = shape.mirror === "twin" ? sideOf(shape, axis) : 0;
  if (side > 0) dx = Math.max(dx, Math.min(0, axis - Math.min(...xs)));
  if (side < 0) dx = Math.min(dx, Math.max(0, axis - Math.max(...xs)));
  const dy = stop(delta.y, shape.points.map((p) => p.y), page.height);
  return { ...shape, points: shape.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}
