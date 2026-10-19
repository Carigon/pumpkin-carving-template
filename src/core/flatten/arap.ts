import type { Point2 } from "../types";
import type { TriangleMesh } from "./mesh";
import { solvePcg, sparseBuilder } from "./sparse";

export interface ArapOptions {
  /** Starting flat layout, roughly to scale and free of folds. */
  initial: Point2[];
  maxIterations?: number;
  /** Stop when the energy improves by less than this fraction. */
  tolerance?: number;
}

const MAX_COT = 1e3;

/**
 * As-rigid-as-possible flattening (Liu et al. 2008, local/global): finds the flat layout that keeps
 * every triangle as close as possible to its true 3D shape. Works on any connected mesh, including
 * meshes with slits cut in (duplicated vertices start together and the slit opens up).
 * The result is defined up to a rigid motion; callers align it.
 */
export function arapFlatten(mesh: TriangleMesh, { initial, maxIterations = 40, tolerance = 1e-6 }: ArapOptions): Point2[] {
  const { vertices, triangles } = mesh;
  const nt = triangles.length;

  // Each triangle in an isometric local 2D frame, plus the cotangent weight of each corner.
  // Edge k runs between corners k+1 and k+2 (opposite corner k).
  const frames = new Float64Array(nt * 6);
  const cots = new Float64Array(nt * 3);
  triangles.forEach(([i0, i1, i2], t) => {
    const p0 = vertices[i0], p1 = vertices[i1], p2 = vertices[i2];
    const e1 = sub(p1, p0), e2 = sub(p2, p0);
    const l1 = Math.hypot(...e1);
    const ex = e1.map((v) => v / l1);
    const x2 = dot3(e2, ex);
    const y2 = Math.hypot(...cross(e1, e2)) / l1;
    const local = [0, 0, l1, 0, x2, y2];
    frames.set(local, t * 6);
    for (let k = 0; k < 3; k++) {
      const [ax, ay] = [local[2 * ((k + 1) % 3)] - local[2 * k], local[2 * ((k + 1) % 3) + 1] - local[2 * k + 1]];
      const [bx, by] = [local[2 * ((k + 2) % 3)] - local[2 * k], local[2 * ((k + 2) % 3) + 1] - local[2 * k + 1]];
      const cot = (ax * bx + ay * by) / Math.abs(ax * by - ay * bx);
      cots[t * 3 + k] = Math.max(-MAX_COT, Math.min(MAX_COT, cot));
    }
  });

  // Pin vertex 0 (translation); rotation is fixed by the per-triangle rotations.
  const pinned = 0;
  const free = new Int32Array(vertices.length).map((_, i) => (i < pinned ? i : i - 1));
  free[pinned] = -1;
  const n = vertices.length - 1;
  const builder = sparseBuilder(n);
  triangles.forEach((tri, t) => {
    for (let k = 0; k < 3; k++) {
      const i = free[tri[(k + 1) % 3]], j = free[tri[(k + 2) % 3]], c = cots[t * 3 + k];
      if (i >= 0) builder.add(i, i, c);
      if (j >= 0) builder.add(j, j, c);
      if (i >= 0 && j >= 0) {
        builder.add(i, j, -c);
        builder.add(j, i, -c);
      }
    }
  });
  const laplacian = builder.build();

  const u = initial.map((p) => ({ ...p }));
  const ux = new Float64Array(n), uy = new Float64Array(n);
  u.forEach((p, v) => {
    if (free[v] >= 0) {
      ux[free[v]] = p.x;
      uy[free[v]] = p.y;
    }
  });
  const rotations = new Float64Array(nt * 2); // cos, sin per triangle
  const bx = new Float64Array(n), by = new Float64Array(n);
  let previous = Infinity;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Local step: best rotation per triangle, in closed form.
    for (let t = 0; t < nt; t++) {
      let s00 = 0, s01 = 0, s10 = 0, s11 = 0;
      forEachEdge(t, (a, b, c, xx, xy) => {
        const dx = u[a].x - u[b].x, dy = u[a].y - u[b].y;
        s00 += c * dx * xx; s01 += c * dx * xy; s10 += c * dy * xx; s11 += c * dy * xy;
      });
      const theta = Math.atan2(s10 - s01, s00 + s11);
      rotations[2 * t] = Math.cos(theta);
      rotations[2 * t + 1] = Math.sin(theta);
    }

    // Global step: one sparse solve per coordinate.
    bx.fill(0);
    by.fill(0);
    for (let t = 0; t < nt; t++) {
      const cs = rotations[2 * t], sn = rotations[2 * t + 1];
      forEachEdge(t, (a, b, c, xx, xy) => {
        const rx = c * (cs * xx - sn * xy), ry = c * (sn * xx + cs * xy);
        const fa = free[a], fb = free[b];
        if (fa >= 0) {
          bx[fa] += rx; by[fa] += ry;
          if (fb < 0) { bx[fa] += c * u[b].x; by[fa] += c * u[b].y; }
        }
        if (fb >= 0) {
          bx[fb] -= rx; by[fb] -= ry;
          if (fa < 0) { bx[fb] += c * u[a].x; by[fb] += c * u[a].y; }
        }
      });
    }
    solvePcg(laplacian, bx, ux);
    solvePcg(laplacian, by, uy);
    u.forEach((p, v) => {
      if (free[v] >= 0) {
        p.x = ux[free[v]];
        p.y = uy[free[v]];
      }
    });

    let energy = 0;
    for (let t = 0; t < nt; t++) {
      const cs = rotations[2 * t], sn = rotations[2 * t + 1];
      forEachEdge(t, (a, b, c, xx, xy) => {
        const ex = u[a].x - u[b].x - (cs * xx - sn * xy);
        const ey = u[a].y - u[b].y - (sn * xx + cs * xy);
        energy += c * (ex * ex + ey * ey);
      });
    }
    if (Math.abs(previous - energy) <= tolerance * previous) break;
    previous = energy;
  }
  return u;

  /** Visit triangle t's edges as (vertex a, vertex b, weight, local edge vector a−b). */
  function forEachEdge(t: number, visit: (a: number, b: number, c: number, xx: number, xy: number) => void): void {
    const tri = triangles[t];
    for (let k = 0; k < 3; k++) {
      const ka = (k + 1) % 3, kb = (k + 2) % 3;
      visit(
        tri[ka],
        tri[kb],
        cots[t * 3 + k],
        frames[t * 6 + 2 * ka] - frames[t * 6 + 2 * kb],
        frames[t * 6 + 2 * ka + 1] - frames[t * 6 + 2 * kb + 1],
      );
    }
  }
}

type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
