import { cross3, dot3, length3, sub3 } from "../geometry/vector";
import type { Point2 } from "../types";
import type { TriangleMesh } from "./mesh";
import { choleskySolver, sparseBuilder } from "./sparse";

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
export function arapFlatten(mesh: TriangleMesh, { initial, maxIterations = 25, tolerance = 1e-6 }: ArapOptions): Point2[] {
  const { vertices, triangles } = mesh;
  const nt = triangles.length;
  const ne = 3 * nt;

  // Every triangle edge (3 per triangle, edge k between corners k+1 and k+2): its vertices a, b, the
  // cotangent weight of the opposite corner, and the edge vector a − b in an isometric 2D frame of the
  // 3D triangle.
  const ea = new Int32Array(ne), eb = new Int32Array(ne);
  const weight = new Float64Array(ne), ex = new Float64Array(ne), ey = new Float64Array(ne);
  triangles.forEach((tri, t) => {
    const [p0, p1, p2] = tri.map((i) => vertices[i]);
    const e1 = sub3(p1, p0), e2 = sub3(p2, p0);
    const l1 = length3(e1);
    const local = [0, 0, l1, 0, dot3(e2, e1) / l1, length3(cross3(e1, e2)) / l1];
    for (let k = 0; k < 3; k++) {
      const ka = (k + 1) % 3, kb = (k + 2) % 3;
      const ax = local[2 * ka] - local[2 * k], ay = local[2 * ka + 1] - local[2 * k + 1];
      const bx = local[2 * kb] - local[2 * k], by = local[2 * kb + 1] - local[2 * k + 1];
      const cot = (ax * bx + ay * by) / Math.abs(ax * by - ay * bx);
      const e = 3 * t + k;
      ea[e] = tri[ka];
      eb[e] = tri[kb];
      weight[e] = Math.max(-MAX_COT, Math.min(MAX_COT, cot));
      ex[e] = local[2 * ka] - local[2 * kb];
      ey[e] = local[2 * ka + 1] - local[2 * kb + 1];
    }
  });

  // Pin vertex 0 (translation); rotation is fixed by the per-triangle rotations. Free vertex v sits at v − 1.
  const n = vertices.length - 1;
  const builder = sparseBuilder(n);
  for (let e = 0; e < ne; e++) {
    const i = ea[e] - 1, j = eb[e] - 1, c = weight[e];
    if (i >= 0) builder.add(i, i, c);
    if (j >= 0) builder.add(j, j, c);
    if (i >= 0 && j >= 0) {
      builder.add(i, j, -c);
      builder.add(j, i, -c);
    }
  }
  // The matrix never changes: factor it once, then each iteration is two triangular solves.
  const solve = choleskySolver(builder.build());

  const ux = Float64Array.from(initial, (p) => p.x), uy = Float64Array.from(initial, (p) => p.y);
  const cos = new Float64Array(nt), sin = new Float64Array(nt);
  const bx = new Float64Array(n), by = new Float64Array(n);
  let previous = Infinity;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Local step: best rotation per triangle, in closed form.
    for (let t = 0; t < nt; t++) {
      let s00 = 0, s01 = 0, s10 = 0, s11 = 0;
      for (let e = 3 * t; e < 3 * t + 3; e++) {
        const c = weight[e], dx = ux[ea[e]] - ux[eb[e]], dy = uy[ea[e]] - uy[eb[e]];
        s00 += c * dx * ex[e]; s01 += c * dx * ey[e]; s10 += c * dy * ex[e]; s11 += c * dy * ey[e];
      }
      const theta = Math.atan2(s10 - s01, s00 + s11);
      cos[t] = Math.cos(theta);
      sin[t] = Math.sin(theta);
    }

    // Global step: one sparse solve per coordinate.
    bx.fill(0);
    by.fill(0);
    for (let e = 0; e < ne; e++) {
      const t = (e / 3) | 0, c = weight[e];
      const rx = c * (cos[t] * ex[e] - sin[t] * ey[e]), ry = c * (sin[t] * ex[e] + cos[t] * ey[e]);
      const fa = ea[e] - 1, fb = eb[e] - 1;
      if (fa >= 0) {
        bx[fa] += rx; by[fa] += ry;
        if (fb < 0) { bx[fa] += c * ux[0]; by[fa] += c * uy[0]; }
      }
      if (fb >= 0) {
        bx[fb] -= rx; by[fb] -= ry;
        if (fa < 0) { bx[fb] += c * ux[0]; by[fb] += c * uy[0]; }
      }
    }
    ux.set(solve(bx), 1);
    uy.set(solve(by), 1);

    let energy = 0;
    for (let e = 0; e < ne; e++) {
      const t = (e / 3) | 0;
      const rx = ux[ea[e]] - ux[eb[e]] - (cos[t] * ex[e] - sin[t] * ey[e]);
      const ry = uy[ea[e]] - uy[eb[e]] - (sin[t] * ex[e] + cos[t] * ey[e]);
      energy += weight[e] * (rx * rx + ry * ry);
    }
    // (The first pass has nothing to compare against: Infinity - E <= tolerance * Infinity would stop it.)
    if (Number.isFinite(previous) && Math.abs(previous - energy) <= tolerance * previous) break;
    previous = energy;
  }
  return Array.from(ux, (x, v) => ({ x, y: uy[v] }));
}
