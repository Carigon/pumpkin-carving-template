import type { MeasurementWarning, ProfilePoint, PumpkinMeasurements, SurfaceParameters } from "../types";
import { ellipsoidSurface } from "./ellipsoid";
import { fitEllipsoid } from "./fitEllipsoid";
import { fitProfile, type ProfileKnot } from "./profile";
import { revolvedSurface } from "./revolved";
import type { Surface } from "./surface";

export type SurfaceFit =
  | { ok: true; surface: Surface; parameters: SurfaceParameters }
  | { ok: false; warnings: MeasurementWarning[] };

/** Points in the reported side profile. */
const PROFILE_POINTS = 257;

/**
 * Fit the pumpkin surface to the tape measurements: the v1 ellipsoid when only the widest ring is given,
 * otherwise a surface of revolution whose front meridian passes through every ring (see `fitProfile`).
 */
export function fitSurface(m: PumpkinMeasurements): SurfaceFit {
  const rings = m.rings ?? [];
  const base = fitEllipsoid(m);
  if (!base.ok) return { ok: false, warnings: [base.warning] };
  const { sideToSide, frontToBack, vertical } = base.semiAxes;
  const depthRatio = frontToBack / sideToSide;

  if (rings.length === 0 && m.circumferenceAt === undefined) {
    const profile: ProfilePoint[] = Array.from({ length: PROFILE_POINTS }, (_, i) => {
      const v = Math.PI / 2 - (Math.PI * i) / (PROFILE_POINTS - 1);
      return { radius: sideToSide * Math.cos(v), height: vertical * Math.sin(v) };
    });
    return {
      ok: true,
      surface: ellipsoidSurface(base.semiAxes),
      parameters: { kind: "ellipsoid", semiAxes: base.semiAxes, profile, depthRatio, units: m.units },
    };
  }

  const warnings = checkRings(m, frontToBack);
  if (warnings.length > 0) return { ok: false, warnings };

  // Every cross-section is an ellipse with the widest one's proportions, so the front-to-back radius
  // scales with the circumference.
  const L = m.frontArc;
  const rhoOf = (circumference: number) => (frontToBack * circumference) / m.circumference;
  const knots: (ProfileKnot & { ring: number | null })[] = rings.map((r, i) => ({ s: r.distance, rho: rhoOf(r.circumference), ring: i }));
  const fit = fitProfile(L, knots, { rho: frontToBack, s: m.circumferenceAt });
  if (!fit.ok) {
    const candidates = m.circumferenceAt === undefined ? knots : [...knots, { s: m.circumferenceAt, rho: frontToBack, ring: null }];
    const nearest = candidates.reduce((a, b) => (Math.abs(b.s - fit.at) < Math.abs(a.s - fit.at) ? b : a));
    return {
      ok: false,
      warnings: [
        ringWarning(
          nearest.ring,
          "No smooth pumpkin shape passes through this ring and its neighbours. Check the distance and circumference.",
        ),
      ],
    };
  }

  const table = fit.table;
  const step = (table.s.length - 1) / (PROFILE_POINTS - 1);
  const profile: ProfilePoint[] = Array.from({ length: PROFILE_POINTS }, (_, i) => {
    const n = Math.round(i * step);
    return { radius: table.rho[n] / depthRatio, height: table.y[n] };
  });
  const widestRho = Math.max(...table.rho);
  return {
    ok: true,
    surface: revolvedSurface(table, depthRatio),
    parameters: {
      kind: "revolved",
      semiAxes: { sideToSide: widestRho / depthRatio, frontToBack: widestRho, vertical: table.y[0] },
      profile,
      depthRatio,
      units: m.units,
    },
  };
}

/**
 * Rings that can't be on any pumpkin: off the arc, bigger than the widest, or changing faster than the
 * arc allows (the radius can't change by more than the distance along the arc, nor exceed the distance
 * to the stem or base).
 */
function checkRings(m: PumpkinMeasurements, widestRho: number): MeasurementWarning[] {
  const rings = m.rings ?? [];
  const L = m.frontArc;
  const units = m.units;
  const fmt = (x: number) => `${Number(x.toFixed(2))} ${units}`;
  const warnings: MeasurementWarning[] = [];
  const rhoOf = (circumference: number) => (widestRho * circumference) / m.circumference;
  const circumferenceOf = (rho: number) => (rho * m.circumference) / widestRho;

  const at = m.circumferenceAt;
  if (at !== undefined && !(Number.isFinite(at) && at > 0 && at < L)) {
    warnings.push({
      kind: "impossible-measurement",
      field: "circumferenceAt",
      message: `Where the widest circumference was taken must be between the stem and the base (0 to ${fmt(L)}).`,
    });
  }
  rings.forEach((r, i) => {
    if (!(Number.isFinite(r.distance) && r.distance > 0 && r.distance < L)) {
      warnings.push(ringWarning(i, `The distance from the stem must be between 0 and the front arc, ${fmt(L)}.`));
    } else if (!(Number.isFinite(r.circumference) && r.circumference > 0)) {
      warnings.push(ringWarning(i, "Circumference must be a positive number."));
    } else if (r.circumference > m.circumference) {
      warnings.push(ringWarning(i, `Bigger than the widest circumference, ${fmt(m.circumference)}.`));
    } else if ((at !== undefined && Math.abs(r.distance - at) < 1e-9) || rings.some((o, j) => j < i && Math.abs(o.distance - r.distance) < 1e-9)) {
      warnings.push(ringWarning(i, "Another ring is already at this distance from the stem."));
    }
  });
  if (warnings.length > 0) return warnings;

  // Poles, the widest ring if placed, and the rings, in order down the arc.
  type Knot = { s: number; rho: number; ring: number | null | "pole" };
  const knots: Knot[] = [
    { s: 0, rho: 0, ring: "pole" },
    { s: L, rho: 0, ring: "pole" },
    ...rings.map((r, i): Knot => ({ s: r.distance, rho: rhoOf(r.circumference), ring: i })),
  ];
  if (at !== undefined) knots.push({ s: at, rho: widestRho, ring: null });
  knots.sort((a, b) => a.s - b.s);
  const blamed = new Set<number | null>();
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i];
    if (Math.abs(b.rho - a.rho) < b.s - a.s) continue;
    // Blame an extra ring over the widest one, and the later ring of two.
    const culprit = b.ring !== "pole" && b.ring !== null ? b : a.ring !== "pole" && a.ring !== null ? a : b.ring !== "pole" ? b : a;
    const ring = culprit.ring as number | null;
    if (blamed.has(ring)) continue;
    blamed.add(ring);
    const other = culprit === a ? b : a;
    const gap = Math.abs(culprit.s - other.s);
    const message =
      other.ring === "pole"
        ? `Too big for its place on the arc: ${fmt(gap)} from the ${other.s === 0 ? "stem" : "base"}, the circumference can be at most about ${fmt(circumferenceOf(gap))}.`
        : `Changes faster than the arc allows from the ${other.ring === null ? "widest ring" : "ring"} ${fmt(gap)} away: ` +
          `the circumferences there can differ by at most about ${fmt(circumferenceOf(gap))}.`;
    warnings.push(ring === null ? { kind: "impossible-measurement", field: "circumferenceAt", message } : ringWarning(ring, message));
  }
  return warnings;
}

function ringWarning(ring: number | null, message: string): MeasurementWarning {
  return ring === null
    ? { kind: "impossible-measurement", field: "circumferenceAt", message }
    : { kind: "impossible-measurement", field: "ring", ring, message };
}
