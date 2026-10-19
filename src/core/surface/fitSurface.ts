import type { MeasurementWarning, ProfilePoint, PumpkinMeasurements, SurfaceParameters } from "../types";
import { angleAt, fitProfile, profileAt } from "./profile";
import { meshSurface } from "../mesh/meshSurface";
import { convertLength } from "../units";
import { revolvedSurface } from "./revolved";
import { revolvedMesh } from "./revolvedMesh";
import type { Surface } from "./surface";

export type SurfaceFit =
  | {
      ok: true;
      surface: Surface;
      parameters: SurfaceParameters;
      /** The fitted radius at a position (0 = bottom, 1 = top). */
      radiusAt(position: number): number;
    }
  | { ok: false; warnings: MeasurementWarning[] };

/** Points in the reported side profile. */
const PROFILE_POINTS = 257;
/** Furthest a facet of the mesh may stray from the smooth shape: 0.25 mm. */
const MESH_TOLERANCE_CM = 0.025;

/**
 * Fit the pumpkin surface to the tape measurements: the smoothest side profile through every ring at its
 * height, widest at the largest ring (see `fitProfile`), spun around the vertical axis, then triangulated. The mesh
 * is the surface projection works against.
 */
export function fitSurface(m: PumpkinMeasurements): SurfaceFit {
  const warnings = checkMeasurements(m);
  if (warnings.length > 0) return { ok: false, warnings };

  const fit = fitProfile(
    m.height,
    m.rings.map((r) => ({ position: r.position, radius: r.circumference / (2 * Math.PI) })),
  );
  if (!fit.ok) {
    return {
      ok: false,
      warnings: [ringWarning(fit.ring, "No smooth pumpkin shape passes through these rings. Check their heights and circumferences.")],
    };
  }

  const profile: ProfilePoint[] = Array.from({ length: PROFILE_POINTS }, (_, i) => {
    const p = profileAt(fit.profile, (Math.PI * i) / (PROFILE_POINTS - 1));
    return { radius: p.radius, height: p.y };
  });
  const smooth = revolvedSurface(fit.profile);
  const mesh = revolvedMesh(fit.profile, smooth, convertLength(MESH_TOLERANCE_CM, "cm", m.units));
  const widest = Math.max(...m.rings.map((r) => r.circumference / (2 * Math.PI)), ...profile.map((p) => p.radius));
  return {
    ok: true,
    surface: meshSurface(mesh, smooth),
    parameters: {
      kind: fit.ellipsoid ? "ellipsoid" : "revolved",
      semiAxes: { sideToSide: widest, frontToBack: widest, vertical: m.height / 2 },
      profile,
      mesh,
      units: m.units,
    },
    radiusAt: (position) => profileAt(fit.profile, angleAt(position)).radius,
  };
}

/** Measurements that can't be a pumpkin: no height, no rings, rings off the pumpkin or on top of each other. */
function checkMeasurements({ height, rings, units }: PumpkinMeasurements): MeasurementWarning[] {
  const fmt = (x: number) => `${Number(x.toFixed(2))} ${units}`;
  const warnings: MeasurementWarning[] = [];
  const heightOk = Number.isFinite(height) && height > 0;
  if (!heightOk) warnings.push({ kind: "impossible-measurement", field: "height", message: "Height must be a positive number." });
  if (rings.length === 0) {
    warnings.push({ kind: "impossible-measurement", field: "ring", message: "Measure at least one ring: the widest circumference." });
  }
  rings.forEach((r, i) => {
    if (!(Number.isFinite(r.position) && r.position > 0 && r.position < 1)) {
      const range = heightOk ? `, more than 0 and less than ${fmt(height)} above the table` : "";
      warnings.push(ringWarning(i, `The ring must be between the bottom and the top of the pumpkin${range}.`));
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
