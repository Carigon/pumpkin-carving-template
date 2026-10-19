import { profileAt, type Profile } from "./profile";
import type { Surface, SurfaceCoords, SurfaceHit, SurfaceSample, Vec3 } from "./surface";

/**
 * A side profile spun around the vertical axis: every horizontal cross-section is a circle.
 *
 * Coordinates: u = longitude (radians, 0 at the front, + toward +x), as on the ellipsoid;
 * v = π/2 − φ with φ the profile's angle from the stem, so +π/2 is the stem, −π/2 the base, and on an
 * ellipsoid v is the parametric latitude.
 */
export function revolvedSurface(profile: Profile): Surface {
  const half = profile.height / 2;
  const phiAt = (v: number) => Math.min(Math.PI, Math.max(0, Math.PI / 2 - v));

  const normalAt = (u: number, p: ReturnType<typeof profileAt>): Vec3 => {
    // Outward normal = ∂P/∂φ × ∂P/∂u / ρ, P = (ρ sin u, y, ρ cos u). Defined at the poles too.
    const n: Vec3 = [-p.dy * Math.sin(u), p.dRadius, -p.dy * Math.cos(u)];
    const len = Math.hypot(...n) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  };

  return {
    coordRange: { minU: -Math.PI, maxU: Math.PI, minV: -Math.PI / 2, maxV: Math.PI / 2 },
    sample({ u, v }: SurfaceCoords): SurfaceSample {
      const p = profileAt(profile, phiAt(v));
      return { point: [p.radius * Math.sin(u), p.y, p.radius * Math.cos(u)], normal: normalAt(u, p) };
    },
    hitAlongView(x: number, y: number): SurfaceHit | null {
      if (!(Math.abs(y) < half)) return null;
      const phi = Math.acos(y / half);
      const p = profileAt(profile, phi);
      const rest = 1 - (x / p.radius) ** 2;
      if (!(rest >= 0)) return null;
      const z = p.radius * Math.sqrt(rest);
      const u = Math.atan2(x, z);
      return { point: [x, y, z], normal: normalAt(u, p), coords: { u, v: Math.PI / 2 - phi } };
    },
  };
}
