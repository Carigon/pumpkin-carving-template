import type { Units } from "./types";

const CM_PER_INCH = 2.54;
const PER_INCH: Record<Units, number> = { in: 1, cm: CM_PER_INCH };

/** Convert a length between units. */
export function convertLength(value: number, from: Units, to: Units): number {
  return from === to ? value : (value / PER_INCH[from]) * PER_INCH[to];
}

/** A length given in inches, in `units`. */
export function fromInches(inches: number, units: Units): number {
  return convertLength(inches, "in", units);
}
