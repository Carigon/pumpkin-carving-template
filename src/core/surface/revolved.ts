import type { ProfileTable } from "./profile";
import type { Surface, SurfaceCoords, SurfaceHit, SurfaceSample, Vec3 } from "./surface";

/**
 * A side profile spun around the vertical axis, with elliptical cross-sections of a fixed
 * front-to-back : side-to-side ratio. The profile gives the front-to-back radius ρ(s) and height y(s)
 * against arc length s along the front meridian; the side-to-side radius is ρ / depthRatio.
 *
 * Coordinates: u = longitude (radians, 0 at the front, + toward +x), as on the ellipsoid;
 * v = π/2 − π s / L, so +π/2 is the stem, −π/2 the base, and on a sphere v is the latitude.
 */
export function revolvedSurface(profile: ProfileTable, depthRatio: number): Surface {
  const { length: L, s: nodes, y: ys } = profile;
  const M = nodes.length - 1;
  const h = L / M;
  const k = depthRatio;

  /** ρ, y and their s-derivatives at arc length s (cubic Hermite between nodes). */
  const at = (s: number) => {
    const m = Math.min(M - 1, Math.max(0, Math.floor(s / h)));
    const t = Math.min(1, Math.max(0, (s - m * h) / h));
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const d00 = (6 * t2 - 6 * t) / h, d10 = 3 * t2 - 4 * t + 1, d01 = (-6 * t2 + 6 * t) / h, d11 = 3 * t2 - 2 * t;
    const herm = (f: Float64Array, df: Float64Array) => ({
      value: h00 * f[m] + h10 * h * df[m] + h01 * f[m + 1] + h11 * h * df[m + 1],
      slope: d00 * f[m] + d10 * df[m] + d01 * f[m + 1] + d11 * df[m + 1],
    });
    const rho = herm(profile.rho, profile.drho);
    const y = herm(profile.y, profile.dy);
    return { rho: rho.value, drho: rho.slope, y: y.value, dy: y.slope };
  };

  const sAt = (v: number) => Math.min(L, Math.max(0, ((Math.PI / 2 - v) * L) / Math.PI));
  const vAt = (s: number) => Math.PI / 2 - (Math.PI * s) / L;

  const normalAt = (u: number, p: ReturnType<typeof at>): Vec3 => {
    const a = p.rho / k, da = p.drho / k;
    // Outward normal = ∂P/∂s × ∂P/∂u, P = (a sin u, y, ρ cos u).
    const ps: Vec3 = [da * Math.sin(u), p.dy, p.drho * Math.cos(u)];
    const pu: Vec3 = [a * Math.cos(u), 0, -p.rho * Math.sin(u)];
    const n: Vec3 = [ps[1] * pu[2] - ps[2] * pu[1], ps[2] * pu[0] - ps[0] * pu[2], ps[0] * pu[1] - ps[1] * pu[0]];
    const len = Math.hypot(...n) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  };

  return {
    coordRange: { minU: -Math.PI, maxU: Math.PI, minV: -Math.PI / 2, maxV: Math.PI / 2 },
    sample({ u, v }: SurfaceCoords): SurfaceSample {
      const p = at(sAt(v));
      return { point: [(p.rho / k) * Math.sin(u), p.y, p.rho * Math.cos(u)], normal: normalAt(u, p) };
    },
    hitAlongView(x: number, y: number): SurfaceHit | null {
      if (!(y < ys[0] && y > ys[M])) return null;
      // Height falls along the meridian: find the node interval, then bisect within it.
      let lo = 0, hi = M;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ys[mid] > y) lo = mid;
        else hi = mid;
      }
      let a = lo * h, b = hi * h;
      for (let i = 0; i < 60; i++) {
        const mid = (a + b) / 2;
        if (at(mid).y > y) a = mid;
        else b = mid;
      }
      const s = (a + b) / 2;
      const p = at(s);
      const sideRadius = p.rho / k;
      const rest = 1 - (x / sideRadius) ** 2;
      if (!(rest >= 0)) return null;
      const z = p.rho * Math.sqrt(rest);
      const u = Math.atan2(x / sideRadius, z / p.rho);
      return { point: [x, y, z], normal: normalAt(u, p), coords: { u, v: vAt(s) } };
    },
  };
}
