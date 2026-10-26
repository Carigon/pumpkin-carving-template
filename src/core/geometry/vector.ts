import type { Vec3 } from "../surface/surface";
import type { Point2 } from "../types";

// Small vector helpers shared across the core.

export const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Average of the points. */
export function centroid(points: Point2[]): Point2 {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

/** Length of an open polyline. */
export function polylineLength(line: readonly Point2[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distance(line[i - 1], line[i]);
  return total;
}

/** Barycentric combination of three points. */
export function barycentric([a, b, c]: Point2[], [w0, w1, w2]: readonly number[]): Point2 {
  return { x: w0 * a.x + w1 * b.x + w2 * c.x, y: w0 * a.y + w1 * b.y + w2 * c.y };
}

export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add3 = (...vs: Vec3[]): Vec3 => vs.reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize3 = (a: Vec3): Vec3 => scale3(a, 1 / (length3(a) || 1));
