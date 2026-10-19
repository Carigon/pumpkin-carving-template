import { profileAt, type Profile } from "./profile";
import type { Surface } from "./surface";
import type { SurfaceMesh } from "../types";

/** Intervals the meridian starts with before it is split where it bends. */
const START_ROWS = 16;
/**
 * Least tolerance as a fraction of the pumpkin's size (its widest radius or half its height). Bounds the mesh for
 * sizes past any real pumpkin: 0.25 mm still holds up to a radius of about 1 m.
 */
const RELATIVE_TOLERANCE = 1 / 4000;
/** Most halvings of a starting interval. */
const MAX_HALVINGS = 8;
/** Places down the meridian where the widest radius is looked for. */
const WIDEST_SAMPLES = 256;
/** Places checked along each meridian interval against its chord. */
const CHECKS = 8;

/**
 * Triangulate the profile spun around the vertical axis, with no facet further than `tolerance` from the smooth
 * shape (or `RELATIVE_TOLERANCE` of its size, if that is more). Half the tolerance goes down the meridian, half
 * around the circle: the faces between two rows are flat trapezoids that sag by about the sum of the two.
 *
 * Rows are circles at angles φ down the meridian; columns run from u = −π to π (the seam is at the back, its
 * vertices doubled). Each pole is one vertex per column, at the column's middle u.
 */
export function revolvedMesh(profile: Profile, surface: Surface, tolerance: number): SurfaceMesh {
  const widest = Math.max(
    ...Array.from({ length: WIDEST_SAMPLES + 1 }, (_, i) => profileAt(profile, (Math.PI * i) / WIDEST_SAMPLES).radius),
  );
  const sag = Math.max(tolerance, RELATIVE_TOLERANCE * Math.max(widest, profile.height / 2)) / 2;
  const phis = meridianRows(profile, sag);
  // A circle of radius ρ split into n chords sags by ρ(1 − cos(π/n)). Columns at the front and sides (multiple of 4).
  const needed = Math.PI / Math.acos(Math.max(-1, 1 - sag / widest));
  const segments = Math.max(8, 4 * Math.ceil(needed / 4));

  const positions: number[] = [];
  const normals: number[] = [];
  const uAt = (j: number) => -Math.PI + (2 * Math.PI * j) / segments;

  const last = phis.length - 1;
  const rows = phis.map((phi, r) => {
    // The row's point and normal at the front (u = 0), turned around the vertical axis to each column.
    const v = Math.PI / 2 - phi;
    const { point: [, y, radius], normal: [, ny, nr] } = surface.sample({ u: 0, v });
    const pole = r === 0 || r === last;
    return Array.from({ length: pole ? segments : segments + 1 }, (_, j) => {
      const u = uAt(pole ? j + 0.5 : j);
      const sin = Math.sin(u), cos = Math.cos(u);
      positions.push(radius * sin, y, radius * cos);
      normals.push(nr * sin, ny, nr * cos);
      return positions.length / 3 - 1;
    });
  });

  const triangles: number[] = [];
  for (let r = 0; r < last; r++) {
    const top = rows[r], bottom = rows[r + 1];
    for (let j = 0; j < segments; j++) {
      // Counterclockwise from outside: down the meridian (+φ) then around (+u).
      if (r === 0) triangles.push(top[j], bottom[j], bottom[j + 1]);
      else if (r + 1 === last) triangles.push(top[j], bottom[j], top[j + 1]);
      else triangles.push(top[j], bottom[j], bottom[j + 1], top[j], bottom[j + 1], top[j + 1]);
    }
  }

  return {
    positions: Float64Array.from(positions),
    normals: Float64Array.from(normals),
    triangles: Uint32Array.from(triangles),
  };
}

/** Angles φ from the stem (0) to the base (π) such that the profile strays no more than `sag` from each chord. */
function meridianRows(profile: Profile, sag: number): number[] {
  const at = (phi: number) => {
    const p = profileAt(profile, phi);
    return [p.radius, p.y] as const;
  };
  const strays = (a: number, b: number) => {
    const [r0, y0] = at(a), [r1, y1] = at(b);
    const length = Math.hypot(r1 - r0, y1 - y0) || 1;
    for (let i = 1; i < CHECKS; i++) {
      const [r, y] = at(a + ((b - a) * i) / CHECKS);
      if (Math.abs((r - r0) * (y1 - y0) - (y - y0) * (r1 - r0)) / length > sag) return true;
    }
    return false;
  };
  const phis = [0];
  const split = (a: number, b: number, depth: number) => {
    if (depth < MAX_HALVINGS && strays(a, b)) {
      split(a, (a + b) / 2, depth + 1);
      split((a + b) / 2, b, depth + 1);
    } else phis.push(b);
  };
  for (let i = 0; i < START_ROWS; i++) split((Math.PI * i) / START_ROWS, (Math.PI * (i + 1)) / START_ROWS, 0);
  return phis;
}
