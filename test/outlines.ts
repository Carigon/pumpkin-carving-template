/**
 * The one shared helper that compares outlines as geometry (ADR 0001): flattened closed paths within a tolerance,
 * whatever their order, start point or direction. Never as point lists or `d` text.
 */
import { expect } from "vitest";
import type { Point2 } from "../src/core";
import { flattenPathData } from "../src/input/flattenPath";

/** SVG path data (e.g. a drawn shape's `d`) as closed polylines, in the path's own coordinates. */
export function outlinesOf(d: string, tolerance = 0.01): Point2[][] {
  return flattenPathData(d, "", tolerance);
}

/**
 * Expect `actual` and `expected` to be the same set of closed outlines: each expected outline matched by its own
 * actual one whose boundary lies within `tolerance` of it everywhere, and the other way round.
 */
export function expectSameOutlines(actual: readonly Point2[][], expected: readonly Point2[][], tolerance: number): void {
  const unmatched = [...actual];
  const missing: Point2[][] = [];
  for (const want of expected) {
    const i = unmatched.findIndex((got) => boundaryDistance(got, want, tolerance) <= tolerance);
    if (i < 0) missing.push(want);
    else unmatched.splice(i, 1);
  }
  expect({ missing, extra: unmatched }, `outlines differ by more than ${tolerance}`).toEqual({ missing: [], extra: [] });
}

/**
 * The larger of the two one-way distances between the outlines' boundaries, from samples along each: every vertex
 * and up to `MAX_SAMPLES_PER_EDGE` points between, `step` apart.
 */
function boundaryDistance(a: readonly Point2[], b: readonly Point2[], step: number): number {
  const [boxA, boxB] = [box(a), box(b)];
  const apart = Math.max(...boxA.map((v, i) => Math.abs(v - boxB[i])));
  if (apart > step) return apart; // the boxes alone show they differ
  const far = (from: readonly Point2[], to: readonly Point2[]) =>
    Math.max(...samples(from, step / 2).map((p) => distanceToOutline(p, to)));
  return Math.max(far(a, b), far(b, a));
}

/** Samples per edge at most, so a fine tolerance on a long edge stays quick. */
const MAX_SAMPLES_PER_EDGE = 32;

/** Points along a closed outline: its vertices, and points between no further apart than `step` where they fit. */
function samples(outline: readonly Point2[], step: number): Point2[] {
  const out: Point2[] = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const n = Math.min(MAX_SAMPLES_PER_EDGE, Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / step)));
    for (let k = 0; k < n; k++) out.push({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
  });
  return out;
}

/** An outline's box as [minX, minY, maxX, maxY]. */
function box(outline: readonly Point2[]): number[] {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function distanceToOutline(p: Point2, outline: readonly Point2[]): number {
  let best = Infinity;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  });
  return best;
}
