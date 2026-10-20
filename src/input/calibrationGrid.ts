import type { Design, Point2, PumpkinMeasurements } from "../core";

/** Bar width as a fraction of the cell pitch. */
const BAR = 0.12;
/** Points per side of each square, so straight lines bend correctly when projected onto the ball. */
const STEPS_PER_SIDE = 8;

/**
 * A square calibration grid of `cells` x `cells` equal squares, in design units (one cell pitch = 1).
 * The outer square is the first path and each cell is a hole inside it, so filling even-odd prints the grid bars.
 */
export function gridDesign(cells: number): Design {
  const n = Math.max(1, Math.round(cells));
  const size = n + BAR;
  const paths: Point2[][] = [square(0, 0, size)];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) paths.push(square(col + BAR, row + BAR, 1 - BAR));
  }
  return { paths, bbox: { minX: 0, minY: 0, maxX: size, maxY: size } };
}

/**
 * Ball mode: a sphere from a single circumference (mm), as tall as it is wide (circumference ÷ π) and widest at
 * mid-height.
 */
export function ballMeasurements(circumference: number): PumpkinMeasurements {
  return { height: circumference / Math.PI, rings: [{ circumference, position: 0.5 }] };
}

function square(x: number, y: number, size: number): Point2[] {
  const corners: Point2[] = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  const out: Point2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (let s = 0; s < STEPS_PER_SIDE; s++) {
      const t = s / STEPS_PER_SIDE;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
