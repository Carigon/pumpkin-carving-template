/**
 * Perimeter of an ellipse with semi-axes a and b.
 * Trapezoid rule over a full period of a smooth periodic integrand converges exponentially fast.
 */
export function ellipsePerimeter(a: number, b: number): number {
  const n = 512;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    sum += Math.hypot(a * Math.sin(t), b * Math.cos(t));
  }
  return (sum * 2 * Math.PI) / n;
}

/**
 * Find the semi-axis x > 0 such that ellipsePerimeter(known, x) === perimeter.
 * Perimeter grows monotonically with x, from 4·known (x → 0) to infinity.
 * Returns null when no such x exists.
 */
export function solveSemiAxisForPerimeter(known: number, perimeter: number): number | null {
  if (!(perimeter > 4 * known)) return null;
  let lo = 0;
  let hi = Math.max(known, perimeter / 4);
  while (ellipsePerimeter(known, hi) < perimeter) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (ellipsePerimeter(known, mid) < perimeter) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
