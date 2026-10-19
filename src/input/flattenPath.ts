import svgpath from "svgpath";
import type { Point2 } from "../core";

/**
 * Turn SVG path data (with its accumulated transform attribute string) into closed polylines,
 * breaking curves into segments that stay within `tolerance` of the true curve.
 * Every subpath is treated as closed (SVG fill semantics). Coordinates stay in SVG space (y down).
 * Pure: no DOM.
 */
export function flattenPathData(d: string, transform: string, tolerance: number): Point2[][] {
  const out: Point2[][] = [];
  let cur: Point2[] = [];
  let start: Point2 = { x: 0, y: 0 };
  const flush = () => {
    const cleaned = dedupe(cur, tolerance / 10);
    if (cleaned.length >= 3) out.push(cleaned);
    cur = [];
  };

  svgpath(d)
    .transform(transform)
    .unshort()
    .unarc()
    .abs()
    .iterate((s, _i, x, y) => {
      const p0 = { x, y };
      if (s[0] !== "M" && s[0] !== "Z" && s[0] !== "z" && cur.length === 0) cur = [{ ...start }];
      switch (s[0]) {
        case "M":
          flush();
          start = { x: s[1], y: s[2] };
          cur = [start];
          break;
        case "L":
          cur.push({ x: s[1], y: s[2] });
          break;
        case "H":
          cur.push({ x: s[1], y });
          break;
        case "V":
          cur.push({ x, y: s[1] });
          break;
        case "C":
          cubic(cur, p0, { x: s[1], y: s[2] }, { x: s[3], y: s[4] }, { x: s[5], y: s[6] }, tolerance);
          break;
        case "Q": {
          const q = { x: s[1], y: s[2] };
          const p3 = { x: s[3], y: s[4] };
          cubic(cur, p0, lerp(p0, q, 2 / 3), lerp(p3, q, 2 / 3), p3, tolerance);
          break;
        }
        case "Z":
        case "z":
          flush();
          break;
      }
    });
  flush();
  return out;
}

/** Bounding box of the raw (transformed) path geometry, control points included. Used to pick a tolerance. */
export function roughExtent(d: string, transform: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  };
  svgpath(d)
    .transform(transform)
    .unshort()
    .unarc()
    .abs()
    .iterate((s, _i, x, y) => {
      add(x, y);
      if (s[0] === "H") add(s[1], y);
      else if (s[0] === "V") add(x, s[1]);
      else for (let i = 1; i + 1 < s.length; i += 2) add(s[i] as number, s[i + 1] as number);
    });
  return box;
}

/** Cubic Bézier flattened with Wang's formula: uniform steps, guaranteed within `tol`. */
function cubic(out: Point2[], p0: Point2, p1: Point2, p2: Point2, p3: Point2, tol: number): void {
  const m = Math.max(
    Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
    Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
  );
  const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * m) / tol)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const e = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y });
  }
}

function lerp(a: Point2, b: Point2, t: number): Point2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Drop consecutive near-duplicates and the closing point that repeats the first. */
function dedupe(points: Point2[], eps: number): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= eps) {
    out.pop();
  }
  return out;
}
