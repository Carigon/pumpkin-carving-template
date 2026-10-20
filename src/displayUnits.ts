import type { Units } from "./core";

/** Millimetres per display unit. */
const MM_PER: Record<Units, number> = { in: 25.4, cm: 10 };
/** Decimals a length is shown to: 0.01 in, 0.1 cm (1 mm). */
const DECIMALS: Record<Units, number> = { in: 2, cm: 1 };

/** A length in mm, in the display units (exact, not rounded). */
export function fromMm(mm: number, units: Units): number {
  return mm / MM_PER[units];
}

/** A length in the display units, in mm. */
export function toMm(value: number, units: Units): number {
  return value * MM_PER[units];
}

/** A length in mm as the carver reads it: in the display units, rounded to their precision, without the unit. */
export function shownLength(mm: number, units: Units): string {
  const scale = 10 ** DECIMALS[units];
  return String(Math.round(fromMm(mm, units) * scale) / scale);
}

/** A length in mm as the carver reads it, with the unit (e.g. "6.13 in"). */
export function formatLength(mm: number, units: Units): string {
  return `${shownLength(mm, units)} ${units}`;
}
