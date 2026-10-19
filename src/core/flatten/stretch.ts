import type { Vec3 } from "../surface/surface";
import { cross3, dot3, length3, sub3 } from "../geometry/vector";
import type { Point2, StretchMap } from "../types";
import type { TriangleMesh } from "./mesh";

/**
 * Stretch of each flattened triangle against its original on the surface.
 *
 * The affine map from the surface triangle (in an isometric 2D frame) to the paper triangle has
 * singular values σ1 ≥ σ2. The scalar stretch is `max(σ1, 1/σ2) − 1`: 0 means the paper triangle is
 * an exact copy, 0.05 means some direction is 5 % longer or shorter on paper than on the surface.
 * A flipped or collapsed paper triangle gets a huge (but finite) value.
 *
 * The 3D side carries the mesh's blended vertex normals, for shading the tint.
 */
export function stretchMap(mesh: TriangleMesh, flat: Point2[]): StretchMap {
  const values: number[] = [];
  const areas: number[] = [];
  for (const [i0, i1, i2] of mesh.triangles) {
    const { sigma1, sigma2, area } = singularValues(mesh.vertices[i0], mesh.vertices[i1], mesh.vertices[i2], flat[i0], flat[i1], flat[i2]);
    values.push(area > 0 ? Math.max(sigma1, 1 / Math.max(sigma2, 1e-6)) - 1 : 0);
    areas.push(area);
  }
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const weighted = values.reduce((s, v, t) => s + areas[t] * v * v, 0);
  return {
    triangles: mesh.triangles.map((t) => [...t] as [number, number, number]),
    surface: mesh.vertices.map((v) => [...v] as Vec3),
    normals: mesh.normals.map((n) => [...n] as Vec3),
    flat: flat.map((p) => ({ ...p })),
    values,
    max: values.reduce((m, v) => Math.max(m, v), 0),
    rms: totalArea > 0 ? Math.sqrt(weighted / totalArea) : 0,
  };
}

/** Singular values of the surface → paper map of one triangle, plus the surface triangle's area. */
function singularValues(p0: Vec3, p1: Vec3, p2: Vec3, u0: Point2, u1: Point2, u2: Point2) {
  // Isometric 2D frame of the 3D triangle: x0 = (0,0), x1 = (|e1|, 0), x2 = (e2·ex, e2·ey).
  const e1 = sub3(p1, p0), e2 = sub3(p2, p0);
  const l1 = length3(e1);
  const twiceArea = length3(cross3(e1, e2));
  if (l1 === 0 || twiceArea === 0) return { sigma1: 1, sigma2: 1, area: 0 };
  const x2x = dot3(e1, e2) / l1;
  const x2y = twiceArea / l1;

  // J = [u1−u0 | u2−u0] · inv([[l1, x2x], [0, x2y]])
  const ax = u1.x - u0.x, ay = u1.y - u0.y, bx = u2.x - u0.x, by = u2.y - u0.y;
  const a = ax / l1, c = ay / l1;
  const b = (bx - a * x2x) / x2y, d = (by - c * x2x) / x2y;

  const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G);
  // det J < 0 (a flipped triangle) shows up as Q < R; treat it as fully collapsed.
  const sigma2 = Q >= R ? Q - R : 0;
  return { sigma1: Q + R, sigma2, area: twiceArea / 2 };
}

/** Summary of the stretch over part of a flattened mesh, weighted by surface area. */
export interface StrainSummary {
  rms: number;
  /** 95th percentile: 5 % of the area stretches more. */
  p95: number;
}

/**
 * The stretch of a flattened mesh over the triangles `on` picks out (e.g. those on the paper), weighted by surface
 * area: its root mean square and 95th percentile. The worst single triangles sit at slit tips and depend on how
 * finely the tip is meshed, so the maximum is left out.
 */
export function strainSummary(mesh: TriangleMesh, flat: Point2[], on: ArrayLike<boolean | number>): StrainSummary {
  const values: number[] = [];
  const areas: number[] = [];
  mesh.triangles.forEach(([i0, i1, i2], t) => {
    if (!on[t]) return;
    const { sigma1, sigma2, area } = singularValues(mesh.vertices[i0], mesh.vertices[i1], mesh.vertices[i2], flat[i0], flat[i1], flat[i2]);
    if (area <= 0) return;
    values.push(Math.max(sigma1, 1 / Math.max(sigma2, 1e-6)) - 1);
    areas.push(area);
  });
  const total = areas.reduce((s, a) => s + a, 0);
  if (total === 0) return { rms: 0, p95: 0 };
  const rms = Math.sqrt(values.reduce((s, v, k) => s + areas[k] * v * v, 0) / total);
  const order = values.map((_, k) => k).sort((a, b) => values[a] - values[b]);
  let sum = 0;
  const at = order.find((k) => (sum += areas[k]) >= 0.95 * total) ?? order[order.length - 1];
  return { rms, p95: values[at] };
}
