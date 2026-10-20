import { fitProfile } from "./surface/fitSurface";
import type { PumpkinMeasurements, Ring } from "./types";

/**
 * The circumference a new ring at `position` (0 = bottom, 1 = top) should take: the one the fitted profile already
 * has there, so adding the ring changes nothing until the carver measures it. When the measurements don't fit, it
 * blends the rings on either side of `position`, or copies the one ring next to it below the lowest ring or above
 * the highest (NaN when there is none).
 */
export function ringAt(m: PumpkinMeasurements, position: number): number {
  const fit = fitProfile(m);
  if (fit.ok) return 2 * Math.PI * fit.radiusAt(position);

  let below: Ring | undefined, above: Ring | undefined;
  for (const r of m.rings) {
    if (!(Number.isFinite(r.position) && r.position > 0 && r.position < 1)) continue;
    if (r.position <= position) {
      if (!below || r.position > below.position) below = r;
    } else if (!above || r.position < above.position) above = r;
  }
  if (below && above) {
    const t = (position - below.position) / (above.position - below.position);
    return below.circumference + t * (above.circumference - below.circumference);
  }
  return (below ?? above)?.circumference ?? Number.NaN;
}
