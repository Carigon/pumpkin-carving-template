import type { PumpkinMeasurements, Ring, Units } from "./core";
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

/** Which rule held a value back. */
export type ClampLimit = "ring-size" | "height" | "margin" | "shape-ratio";

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

/** The grid a snapped length lands on, counted from 0, mm: ⅛ in, or 1 mm in centimetres. */
export const SNAP_MM: Record<Units, number> = { in: 25.4 / 8, cm: 1 };

/** `mm` on the display unit's grid (see `SNAP_MM`), or as it is when `snap` is off. */
export function snapLength(mm: number, { units, snap }: EditOptions): number {
  return snap ? Math.round(mm / SNAP_MM[units]) * SNAP_MM[units] : mm;
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
