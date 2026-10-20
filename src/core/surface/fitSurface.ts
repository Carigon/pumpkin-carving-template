import type { MeasurementWarning, ProfileFit, ProfilePoint, PumpkinMeasurements, SurfaceParameters } from "../types";
import { angleAt, profileAt, solveProfile } from "./profile";
import { meshSurface, type MeshSurface } from "../mesh/meshSurface";
import { revolvedSurface } from "./revolved";
import { revolvedMesh } from "./revolvedMesh";

export type SurfaceFit =
  | {
      ok: true;
      surface: MeshSurface;
      parameters: SurfaceParameters;
      /** The fitted radius at a position (0 = bottom, 1 = top). */
      radiusAt(position: number): number;
    }
  | { ok: false; warnings: MeasurementWarning[] };

/** Points in the reported side profile. */
const PROFILE_POINTS = 257;
/** Furthest a facet of the mesh may stray from the smooth shape, in mm. */
const MESH_TOLERANCE_MM = 0.25;

/**
 * Fit the pumpkin's profile to the tape measurements: the smoothest one through every ring at its height, widest
 * at the largest ring (see `solveProfile`), sampled from stem to base. No mesh: this is the quick part of
 * `fitSurface`, cheap enough to rerun while a ring is dragged.
 */
export function fitProfile(m: PumpkinMeasurements): ProfileFit {
  const fit = solve(m);
  return fit.ok ? { ok: true, profile: fit.profile, radiusAt: fit.radiusAt } : fit;
}

/**
 * Fit the pumpkin surface to the tape measurements: the profile (see `fitProfile`) spun around the vertical axis,
 * then triangulated. The mesh is the surface projection and flattening work against.
 */
export function fitSurface(m: PumpkinMeasurements): SurfaceFit {
  const fit = solve(m);
  if (!fit.ok) return fit;

  const { profile, solution } = fit;
  const smooth = revolvedSurface(solution.profile);
  const mesh = revolvedMesh(solution.profile, smooth, MESH_TOLERANCE_MM);
  const widest = Math.max(...m.rings.map((r) => r.circumference / (2 * Math.PI)), ...profile.map((p) => p.radius));
  return {
    ok: true,
    surface: meshSurface(mesh),
    parameters: {
      kind: solution.ellipsoid ? "ellipsoid" : "revolved",
      semiAxes: { sideToSide: widest, frontToBack: widest, vertical: m.height / 2 },
      profile,
      mesh,
    },
    radiusAt: fit.radiusAt,
  };
}

/** Check the measurements and solve for the profile, keeping the solver's own form of it for meshing. */
function solve(m: PumpkinMeasurements) {
  const warnings = checkMeasurements(m);
  if (warnings.length > 0) return { ok: false as const, warnings };

  const solution = solveProfile(
    m.height,
    m.rings.map((r) => ({ position: r.position, radius: r.circumference / (2 * Math.PI) })),
  );
  if (!solution.ok) {
    return {
      ok: false as const,
      // Against the rings as a whole: the fit can't tell which ring is to blame.
      warnings: [
        {
          kind: "impossible-measurement",
          field: "ring",
          message: "No smooth pumpkin shape passes through these rings. Check their heights and circumferences.",
        } satisfies MeasurementWarning,
      ],
    };
  }

  const profile: ProfilePoint[] = Array.from({ length: PROFILE_POINTS }, (_, i) => {
    const p = profileAt(solution.profile, (Math.PI * i) / (PROFILE_POINTS - 1));
    return { radius: p.radius, height: p.y };
  });
  const radiusAt = (position: number) => profileAt(solution.profile, angleAt(position)).radius;
  return { ok: true as const, solution, profile, radiusAt };
}

/** Measurements that can't be a pumpkin: no height, no rings, rings off the pumpkin or on top of each other. */
function checkMeasurements({ height, rings }: PumpkinMeasurements): MeasurementWarning[] {
  const warnings: MeasurementWarning[] = [];
  const heightOk = Number.isFinite(height) && height > 0;
  if (!heightOk) warnings.push({ kind: "impossible-measurement", field: "height", message: "Height must be a positive number." });
  if (rings.length === 0) {
    warnings.push({ kind: "impossible-measurement", field: "ring", message: "Measure at least one ring: the widest circumference." });
  }
  rings.forEach((r, i) => {
    if (!(Number.isFinite(r.position) && r.position > 0 && r.position < 1)) {
      warnings.push(ringWarning(i, "The ring must be between the bottom and the top of the pumpkin."));
    } else if (!(Number.isFinite(r.circumference) && r.circumference > 0)) {
      warnings.push(ringWarning(i, "Circumference must be a positive number."));
    } else if (rings.some((o, j) => j < i && Math.abs(o.position - r.position) < 1e-9)) {
      warnings.push(ringWarning(i, "Another ring is already at this height."));
    }
  });
  return warnings;
}

function ringWarning(ring: number, message: string): MeasurementWarning {
  return { kind: "impossible-measurement", field: "ring", ring, message };
}
