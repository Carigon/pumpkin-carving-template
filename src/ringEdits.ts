import { ringAt, type PumpkinMeasurements, type Ring, type Units } from "./core";
import { formatLength } from "./displayUnits";

/**
 * The ring-edit rules: how the measurements may change, shared by the Blueprint view's drags and the Measure
 * form, so both behave the same. Pure, and every length is in mm.
 */

/** A ring's stable id: it keeps a ring's selection and hover through re-sorting and edits. */
export type RingId = number;

/** A ring with its id. */
export interface RingWithId extends Ring {
  id: RingId;
}

/** Measurements in mm whose rings have ids. Usable wherever `PumpkinMeasurements` are. */
export interface RingMeasurements extends PumpkinMeasurements {
  rings: RingWithId[];
}

/**
 * A gap between two neighbouring rings in top-to-bottom order. `above: null` means the gap reaches the top (the
 * height); `below: null` means it reaches the table (0).
 */
export interface Gap {
  above: RingId | null;
  below: RingId | null;
}

/** Which rule held a value back, or refused an insert or delete. */
export type ClampLimit = "ring-size" | "height" | "margin" | "shape-ratio" | "ring-count" | "gap";

/** Why an edit didn't land where it was asked to, for the carver. */
export interface ClampNote {
  limit: ClampLimit;
  message: string;
}

/** An edit's outcome: the new measurements, and a note when a rule clamped the value asked for. */
export interface RingEdit {
  measurements: RingMeasurements;
  note: ClampNote | null;
}

export interface EditOptions {
  /** The display units: what notes are worded in, and the grid a snapped value lands on. */
  units: Units;
  /** Snap to the display unit's grid (drags and nudges); false lets the value go free (Alt, typed values). */
  snap: boolean;
}

/** A ring's radius, mm. */
export const RING_RADIUS = { min: 10, max: 500 };
/** The pumpkin's height, mm. */
export const HEIGHT = { min: 20, max: 1000 };
/** How close a dragged ring comes to its neighbours, the table and the top, mm. */
export const MARGIN = 5;
/** The height over the widest diameter: kept between squat and tall, which take long to build. */
export const SHAPE_RATIO = { min: 0.2, max: 5 };

/** The most rings a pumpkin may have (as many as the saved settings keep). */
export const MAX_RINGS = 20;

/** The grid a snapped length lands on, counted from 0, mm: ⅛ in, or 1 mm in centimetres. */
export const SNAP_MM: Record<Units, number> = { in: 25.4 / 8, cm: 1 };

/** `mm` on the display unit's grid (see `SNAP_MM`), or as it is when `snap` is off. */
export function snapLength(mm: number, { units, snap }: EditOptions): number {
  return snap ? Math.round(mm / SNAP_MM[units]) * SNAP_MM[units] : mm;
}

/**
 * `mm` nudged one step up (`direction` 1) or down (-1) the display unit's grid (see `SNAP_MM`): to the next grid
 * point that way, so a length off the grid lands on it rather than snapping back where it was.
 */
export function nudgeLength(mm: number, direction: 1 | -1, units: Units): number {
  const steps = mm / SNAP_MM[units];
  // A grid point held with float noise counts as on the grid.
  const on = Math.abs(steps - Math.round(steps)) < 1e-6 ? Math.round(steps) : steps;
  return (direction > 0 ? Math.floor(on) + 1 : Math.ceil(on) - 1) * SNAP_MM[units];
}

/** The measurements with ids 0, 1, 2… on their rings, in order. */
export function withRingIds(m: PumpkinMeasurements, firstId: RingId = 0): RingMeasurements {
  return { height: m.height, rings: m.rings.map((r, i) => ({ id: firstId + i, position: r.position, circumference: r.circumference })) };
}

/** The rings in display order, top to bottom, each keeping its id; rings with no height yet go last, in order. */
export function sortRings(m: RingMeasurements): RingMeasurements {
  const key = (r: RingWithId) => (Number.isFinite(r.position) ? r.position : -Infinity);
  return { height: m.height, rings: [...m.rings].sort((a, b) => key(b) - key(a)) };
}

/**
 * Drag ring `id` towards `target`: its height above the table and its circumference, in mm (either left out
 * stays as it is), each snapped as `options` say and then clamped. The limits come from `start`, the measurements as they were when the drag began, so the
 * margin never pulls the ring past where it sat then.
 */
export function dragRing(
  start: RingMeasurements,
  id: RingId,
  target: { above?: number; circumference?: number },
  options: EditOptions,
): RingEdit {
  const ring = start.rings.find((r) => r.id === id);
  if (!ring) return { measurements: start, note: null };
  const { units } = options;
  const H = start.height;
  const notes: ClampNote[] = [];

  let position = ring.position;
  if (target.above !== undefined) {
    const now = ring.position * H;
    const others = start.rings.filter((r) => r.id !== id && Number.isFinite(r.position)).map((r) => r.position * H);
    const below = Math.max(0, ...others.filter((a) => a <= now));
    const over = Math.min(H, ...others.filter((a) => a > now));
    // Never closer than it already is: a ring inside the margin stays put rather than jumping out of it.
    const margin = () => marginNote(units);
    const above = clampTo(snapLength(target.above, options), [{ value: Math.min(below + MARGIN, now), note: margin }], [
      { value: Math.max(over - MARGIN, now), note: margin },
    ]);
    if (above.note) notes.push(above.note);
    position = above.value / H;
  }

  let circumference = ring.circumference;
  if (target.circumference !== undefined) {
    // The widest diameter stays within height ÷ 5 and height × 5: no ring grows past the top, and the widest
    // shrinks only to the bottom unless another ring is at least that wide.
    const othersWidest = Math.max(0, ...start.rings.filter((r) => r.id !== id).map((r) => r.circumference).filter(Number.isFinite));
    const ratio = () => shapeNote();
    const narrowest = (Math.PI * H) / SHAPE_RATIO.max;
    const lows = [ringSize(units).low, ...(othersWidest < narrowest ? [{ value: narrowest, note: ratio }] : [])];
    const highs = [ringSize(units).high, { value: (Math.PI * H) / SHAPE_RATIO.min, note: ratio }];
    const around = clampTo(snapLength(target.circumference, options), lows, Number.isFinite(H) ? highs : highs.slice(0, 1));
    if (around.note) notes.push(around.note);
    circumference = around.value;
  }

  const rings = start.rings.map((r) => (r.id === id ? { ...r, position, circumference } : r));
  return { measurements: { height: H, rings }, note: notes[0] ?? null };
}

/**
 * Drag the ball's ring `id` (test-grid mode) towards `circumference`, mm. A ball is as tall as it is wide, so
 * only the ring size limits apply.
 */
export function dragBall(start: RingMeasurements, id: RingId, circumference: number, options: EditOptions): RingEdit {
  const { low, high } = ringSize(options.units);
  const around = clampTo(snapLength(circumference, options), [low], [high]);
  const rings = start.rings.map((r) => (r.id === id ? { ...r, circumference: around.value } : r));
  return { measurements: { height: start.height, rings }, note: around.note };
}

/**
 * Drag the height towards `target` (mm), from the measurements as they were when the drag started. Every ring
 * keeps its fraction of the height and its circumference, so the rings move in proportion. The height stays
 * within 0.2 and 5 times the widest diameter, and stops where the tightest gap (counting the table and the top)
 * would come within the margin, though never past where it was if that gap already is.
 */
export function dragHeight(start: RingMeasurements, target: number, options: EditOptions): RingEdit {
  const { units } = options;
  const stops = [0, ...start.rings.map((r) => r.position).filter(Number.isFinite), 1].sort((a, b) => a - b);
  const tightest = Math.min(...stops.slice(1).map((s, i) => s - stops[i]));
  const widest = Math.max(0, ...start.rings.map((r) => r.circumference).filter(Number.isFinite)) / Math.PI;
  const heightNote = (): ClampNote => ({
    limit: "height",
    message: `The height is kept between ${formatLength(HEIGHT.min, units)} and ${formatLength(HEIGHT.max, units)}.`,
  });
  const ratio = () => shapeNote();
  const lows: Bound[] = [
    { value: HEIGHT.min, note: heightNote },
    { value: widest * SHAPE_RATIO.min, note: ratio },
    { value: tightest > 0 ? Math.min(MARGIN / tightest, start.height) : 0, note: () => marginNote(units) },
  ];
  const highs: Bound[] = [{ value: HEIGHT.max, note: heightNote }, ...(widest > 0 ? [{ value: widest * SHAPE_RATIO.max, note: ratio }] : [])];
  const { value: height, note } = clampTo(snapLength(target, options), lows, highs);
  return { measurements: { height, rings: start.rings }, note };
}

/** Where `gap` runs, as fractions of the height: from `top` down to `bottom` (NaN for a ring with no height yet). */
function gapSpan(m: RingMeasurements, gap: Gap): { top: number; bottom: number } {
  const at = (id: RingId | null, end: number) => (id === null ? end : (m.rings.find((r) => r.id === id)?.position ?? Number.NaN));
  return { top: at(gap.above, 1), bottom: at(gap.below, 0) };
}

/**
 * Why `gap` can't take a new ring, or null when it can: the pumpkin already has `MAX_RINGS` rings, or the gap is
 * narrower than twice the margin. The rules `insertRing` refuses by, for whoever offers a gap.
 */
export function canInsert(m: RingMeasurements, gap: Gap): ClampNote | null {
  if (m.rings.length >= MAX_RINGS) return { limit: "ring-count", message: `A pumpkin can have up to ${MAX_RINGS} rings.` };
  const { top, bottom } = gapSpan(m, gap);
  if ((top - bottom) * m.height < 2 * MARGIN) {
    return { limit: "gap", message: "That gap is too narrow for another ring: rings are kept a little apart." };
  }
  return null;
}

/**
 * Insert a ring at the middle of `gap`, with the circumference the shape already has there (`ringAt`), so the
 * shape doesn't change until the carver measures it. Refused (the measurements as they were, id null, and a note
 * saying why) where `canInsert` says no. The new ring's id is the largest one so far plus 1; the rings come back
 * sorted top to bottom.
 */
export function insertRing(m: RingMeasurements, gap: Gap): RingEdit & { id: RingId | null } {
  const refused = (note: ClampNote | null) => ({ measurements: m, note, id: null });
  const refusal = canInsert(m, gap);
  if (refusal) return refused(refusal);
  const { top, bottom } = gapSpan(m, gap);
  const H = m.height;
  if (!(H > 0) || !Number.isFinite(top) || !Number.isFinite(bottom)) return refused(null);
  const position = (top + bottom) / 2;
  const circumference = ringAt(m, position);
  if (!Number.isFinite(circumference)) return refused(null);
  const id = Math.max(-1, ...m.rings.map((r) => r.id)) + 1;
  return { measurements: sortRings({ height: H, rings: [...m.rings, { id, position, circumference }] }), note: null, id };
}

/**
 * Delete ring `id`. Refused (the measurements as they were, and a note saying why) for the last ring, and when
 * taking away the widest ring would leave the pumpkin more than `SHAPE_RATIO.max` times as tall as it is wide.
 */
export function deleteRing(m: RingMeasurements, id: RingId): RingEdit {
  if (!m.rings.some((r) => r.id === id)) return { measurements: m, note: null };
  if (m.rings.length <= 1) {
    return { measurements: m, note: { limit: "ring-count", message: "The last ring can't be deleted: the shape needs one." } };
  }
  const rings = m.rings.filter((r) => r.id !== id);
  const widest = (rs: RingWithId[]) => Math.max(0, ...rs.map((r) => r.circumference).filter(Number.isFinite)) / Math.PI;
  const after = widest(rings);
  // Only a delete that narrows the pumpkin can push it out of shape; inserting never widens it.
  if (after < widest(m.rings) && m.height > after * SHAPE_RATIO.max) {
    return {
      measurements: m,
      note: {
        limit: "shape-ratio",
        message: `Deleting this ring would leave the pumpkin more than ${SHAPE_RATIO.max} times as tall as it is wide.`,
      },
    };
  }
  return { measurements: { height: m.height, rings }, note: null };
}

/** A limit on a value, with the note to give when it holds the value back. */
interface Bound {
  value: number;
  note: () => ClampNote;
}

/** `value` held between the highest of `lows` and the lowest of `highs`, with the note of the bound that held it. */
function clampTo(value: number, lows: Bound[], highs: Bound[]): { value: number; note: ClampNote | null } {
  const lo = lows.reduce((a, b) => (b.value > a.value ? b : a));
  const hi = highs.reduce((a, b) => (b.value < a.value ? b : a));
  if (value > hi.value) return { value: hi.value, note: hi.note() };
  if (value < lo.value) return { value: lo.value, note: lo.note() };
  return { value, note: null };
}

/** The ring size limits, as circumferences. */
function ringSize(units: Units): { low: Bound; high: Bound } {
  const lo = 2 * Math.PI * RING_RADIUS.min;
  const hi = 2 * Math.PI * RING_RADIUS.max;
  const note = (): ClampNote => ({
    limit: "ring-size",
    message: `Rings are kept between ${formatLength(lo, units)} and ${formatLength(hi, units)} around.`,
  });
  return { low: { value: lo, note }, high: { value: hi, note } };
}

function marginNote(units: Units): ClampNote {
  return {
    limit: "margin",
    message: `Rings are kept ${formatLength(MARGIN, units)} apart, and as far from the table and the top.`,
  };
}

function shapeNote(): ClampNote {
  return {
    limit: "shape-ratio",
    message: `The pumpkin is kept no more than ${SHAPE_RATIO.max} times as tall as it is wide, or as wide as it is tall.`,
  };
}

/*
 * Typed edits: a value the carver typed in the Measure form, committed (on blur or Enter). Typed values never
 * snap. A typed ring may pass its neighbours (the form re-sorts the rows) and land within the margin of another
 * ring, which is accepted with a soft warning.
 */

/** A typed edit's outcome; `warning` is a soft warning on a value accepted as typed. */
export interface TypedEdit extends RingEdit {
  warning: string | null;
}

/**
 * Type ring `id`'s height above the table, mm: kept the margin above the table and below the top. Within the
 * margin of another ring it's accepted with a soft warning; on another ring's height it's left for the core's
 * error.
 */
export function typeRingHeight(m: RingMeasurements, id: RingId, above: number, units: Units): TypedEdit {
  const H = m.height;
  const note = (): ClampNote => ({
    limit: "margin",
    message: `Rings are kept ${formatLength(MARGIN, units)} from the table and the top.`,
  });
  const clamped = clampTo(above, [{ value: MARGIN, note }], [{ value: Math.max(MARGIN, H - MARGIN), note }]);
  const position = clamped.value / H;
  const rings = m.rings.map((r) => (r.id === id ? { ...r, position } : r));
  // The core's own tolerance for two rings at one height, which it reports as an error.
  const gaps = m.rings.filter((r) => r.id !== id && Number.isFinite(r.position)).map((r) => Math.abs(r.position - position));
  const close = gaps.some((g) => g >= 1e-9 && g * H < MARGIN);
  const warning = close ? `This ring is within ${formatLength(MARGIN, units)} of another.` : null;
  return { measurements: { height: H, rings }, note: clamped.note, warning };
}

/**
 * Type ring `id`'s circumference, mm (a typed diameter d arrives as d·π): kept within the ring size limits and,
 * unless it is the test-grid ball, the shape ratio, as a drag is.
 */
export function typeCircumference(
  m: RingMeasurements,
  id: RingId,
  circumference: number,
  { units, ball }: { units: Units; ball: boolean },
): RingEdit {
  const options = { units, snap: false };
  return ball ? dragBall(m, id, circumference, options) : dragRing(m, id, { circumference }, options);
}

/**
 * Type the pumpkin's height, mm, from the measurements as they were before the carver started typing: held as a
 * dragged height is (20–1000 mm, the shape ratio and the tightest gap), with every ring keeping its fraction and
 * circumference.
 */
export function typeHeight(m: RingMeasurements, height: number, units: Units): RingEdit {
  return dragHeight(m, height, { units, snap: false });
}
