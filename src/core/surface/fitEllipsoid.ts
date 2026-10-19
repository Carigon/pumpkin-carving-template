import type { MeasurementField, MeasurementWarning, PumpkinMeasurements, SemiAxes } from "../types";
import { solveSemiAxisForPerimeter } from "./ellipse";

export type FitResult = { ok: true; semiAxes: SemiAxes } | { ok: false; warning: MeasurementWarning };

/**
 * Fit the v1 ellipsoid (round from above, optional separate depth) to tape-measure measurements.
 * - No depth: horizontal radius = circumference / 2π.
 * - With depth: front-to-back = depth / 2, side-to-side solved so the horizontal ellipse has the circumference.
 * - Height: solved so the front meridian (half an ellipse with semi-axes frontToBack, vertical) has the front arc.
 */
export function fitEllipsoid(m: PumpkinMeasurements): FitResult {
  const { circumference, frontArc, depth, units } = m;
  const fmt = (x: number) => `${Number(x.toFixed(2))} ${units}`;

  if (!isPositive(circumference)) return fail("circumference", "Circumference must be a positive number.");
  if (!isPositive(frontArc)) return fail("frontArc", "Front arc must be a positive number.");
  if (depth !== undefined && !isPositive(depth)) return fail("depth", "Depth must be a positive number.");

  let sideToSide: number;
  let frontToBack: number;
  if (depth === undefined) {
    sideToSide = frontToBack = circumference / (2 * Math.PI);
  } else {
    frontToBack = depth / 2;
    const solved = solveSemiAxisForPerimeter(frontToBack, circumference);
    if (solved === null) {
      return fail(
        "depth",
        `Depth is too large for the circumference: it must be less than half of it (under ${fmt(circumference / 2)}).`,
      );
    }
    sideToSide = solved;
  }

  const vertical = solveSemiAxisForPerimeter(frontToBack, 2 * frontArc);
  if (vertical === null) {
    const across = depth === undefined ? "the width through the pumpkin (circumference ÷ π)" : "the depth";
    return fail(
      "frontArc",
      `Front arc is too short: it must be longer than ${across}, ${fmt(2 * frontToBack)}.`,
    );
  }

  return { ok: true, semiAxes: { sideToSide, frontToBack, vertical } };
}

function isPositive(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

function fail(field: MeasurementField, message: string): FitResult {
  return { ok: false, warning: { kind: "impossible-measurement", field, message } };
}
