import type { SemiAxes } from "../types";
import type { Surface, SurfaceCoords, SurfaceHit, SurfaceSample, Vec3 } from "./surface";

/**
 * Ellipsoid surface. Coordinates: u = longitude (radians, 0 at the front, + toward +x),
 * v = parametric latitude (radians, 0 at the equator, + toward the stem).
 */
export function ellipsoidSurface({ sideToSide: a, vertical: c, frontToBack: b }: SemiAxes): Surface {
  const normalAt = ([x, y, z]: Vec3): Vec3 => normalize([x / (a * a), y / (c * c), z / (b * b)]);

  return {
    coordRange: { minU: -Math.PI, maxU: Math.PI, minV: -Math.PI / 2, maxV: Math.PI / 2 },
    sample({ u, v }: SurfaceCoords): SurfaceSample {
      const point: Vec3 = [a * Math.cos(v) * Math.sin(u), c * Math.sin(v), b * Math.cos(v) * Math.cos(u)];
      return { point, normal: normalAt(point) };
    },
    hitAlongView(x: number, y: number): SurfaceHit | null {
      const rest = 1 - (x / a) ** 2 - (y / c) ** 2;
      if (rest < 0) return null;
      const point: Vec3 = [x, y, b * Math.sqrt(rest)];
      const coords = { u: Math.atan2(x / a, point[2] / b), v: Math.asin(clamp(y / c, -1, 1)) };
      return { point, normal: normalAt(point), coords };
    },
  };
}

function normalize([x, y, z]: Vec3): Vec3 {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
