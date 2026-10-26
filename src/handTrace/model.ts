/**
 * The hand-trace path model (spec #27, ADRs 0003 and 0004), as the stored record will hold it. Coordinates are in
 * design space: relative to the photo or page, one scale on both axes, y up.
 */

/** An offset from a point to its handle's tip, in design space. */
export interface Offset {
  x: number;
  y: number;
}

/**
 * One place a shape's edge passes through. A corner point's handles are independent and a missing one leaves that
 * side straight; a smooth point's stay on one line, and with none stored they're automatic.
 */
export interface Point {
  x: number;
  y: number;
  kind: "corner" | "smooth";
  in?: Offset;
  out?: Offset;
}

/** How a shape is mirrored about the symmetry axis (ADR 0004). */
export type Mirror = "none" | "twin" | "symmetric";

/** One run of points, in the order drawn. Open until closed; only closed shapes are carved. */
export interface Shape {
  /** Stable across edits and undo. */
  id: number;
  closed: boolean;
  mirror: Mirror;
  points: Point[];
}

/** A hand-trace as the stored record holds it: what a reload or a reopened hand-trace file puts back. */
export interface HandTraceRecord {
  /** In the order drawn. */
  shapes: Shape[];
  /** The id of the open shape being drawn, so a reload mid-shape carries on drawing it; null when none is. */
  drawing: number | null;
  /** Done was pressed (and not Edit since). */
  done: boolean;
}

/** The photo or blank page the points are placed on, in design units (a blank page is 1 × 1). */
export interface Page {
  width: number;
  height: number;
}
