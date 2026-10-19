/** Stretch tint: invisible below STRETCH_FAINT, full strength from STRETCH_HEAVY (fractions, 0.05 = 5 %). */
const STRETCH_FAINT = 0.03;
const STRETCH_HEAVY = 0.15;

/** The stretch tint's opacity at full strength, the same on the 3D view and the Paper view. */
export const STRETCH_MAX_ALPHA = 0.75;

/** The stretch tint's strength for a triangle's stretch value, from 0 (none) to 1 (full), easing in between. */
export function stretchTint(value: number): number {
  const k = Math.min(1, Math.max(0, (value - STRETCH_FAINT) / (STRETCH_HEAVY - STRETCH_FAINT)));
  return k * k * (3 - 2 * k);
}
