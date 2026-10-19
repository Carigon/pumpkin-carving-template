import { fitSurface } from "./surface/fitSurface";
import type { PumpkinMeasurements, Ring } from "./types";

/**
 * A ring to add to the measurements: in the middle of the largest gap between the rings (the bottom and top
 * count as edges, and the lower gap wins a tie), with the circumference the fitted shape already has there, so
 * adding it changes nothing until the carver measures it. When the measurements don't fit, the circumference
 * blends the rings on either side of the gap, or copies the one ring next to it when the gap runs to the bottom
 * or top.
 */
export function nextRing(m: PumpkinMeasurements): Ring {
  const placed = m.rings.filter((r) => Number.isFinite(r.position) && r.position > 0 && r.position < 1).sort((a, b) => a.position - b.position);
  const stops = [0, ...placed.map((r) => r.position), 1];
  let gap = 0;
  for (let i = 1; i + 1 < stops.length; i++) {
    if (stops[i + 1] - stops[i] > stops[gap + 1] - stops[gap] + 1e-12) gap = i;
  }
  const position = (stops[gap] + stops[gap + 1]) / 2;

  const fit = fitSurface(m);
  if (fit.ok) return { position, circumference: 2 * Math.PI * fit.radiusAt(position) };
  const below = placed[gap - 1], above = placed[gap];
  if (below && above) {
    const t = (position - below.position) / (above.position - below.position);
    return { position, circumference: below.circumference + t * (above.circumference - below.circumference) };
  }
  return { position, circumference: (below ?? above)?.circumference ?? Number.NaN };
}
