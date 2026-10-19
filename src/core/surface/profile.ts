/**
 * Smooth side profile through tape rings at known heights. The meridian runs from the stem to the base as an
 * angle φ ∈ [0, π], the parametric latitude of an ellipsoid measured from the stem:
 *
 *   y(φ) = (H/2) cos φ,   ρ(φ) = sin φ · q(φ),   q(φ) = Σ_k a_k cos kφ   (k = 0 … K)
 *
 * A ring at position p (0 = table, 1 = top) sits at cos φ = 2p − 1, whatever the shape. Height falls all the
 * way down the meridian, so the profile can't fold back up, and q is even about both poles, so the surface
 * closes smoothly there with a level top and bottom. With q constant this is the ellipsoid with semi-axes
 * (q, q, H/2).
 *
 * The a_k are the smoothest (least Σ_{k≥1} k⁴ a_k², so the ellipsoid costs nothing) that pass through every
 * ring and are level (dρ/dφ = 0) at the widest ring. ρ is linear in the a_k, so that is one quadratic program,
 * and the one-widest-point rule is exact linear inequalities in it: dρ/dφ ≥ 0 above the widest ring and ≤ 0
 * below it, so the widest ring is a true maximum and nothing bulges past it. Rings that narrow and widen again
 * on one side of the widest can't meet that; they get the smoothest profile that stays between the axis and the
 * widest radius instead.
 *
 * The program is convex, so a ring read off the fitted shape and added to the others changes nothing.
 */

/** A ring the profile must pass through: radius at a position (0 = bottom, 1 = top). */
export interface ProfileRing {
  position: number;
  radius: number;
}

export interface Profile {
  /** Overall height H. */
  height: number;
  /** a_k, k = 0 … K: q(φ) = Σ a_k cos kφ. */
  coefficients: Float64Array;
}

export type ProfileFit =
  /** `ellipsoid`: the fitted shape is the ellipsoid through the widest ring. */
  | { ok: true; profile: Profile; ellipsoid: boolean }
  /** `ring`: the ring to blame (the widest). */
  | { ok: false; ring: number };

/** Places down the meridian where the shape rules are enforced. */
const NODES = 256;
/**
 * Terms of q after a_0. Fixed rather than growing with the rings, so a ring read off the fit and added leaves the
 * fit unchanged however many there are.
 */
const MODES = 32;

/** The angle φ from the stem of a ring at `position`. */
export function angleAt(position: number): number {
  return Math.acos(Math.min(1, Math.max(-1, 2 * position - 1)));
}

/** Radius ρ, height y and their φ-derivatives at angle φ from the stem. */
export function profileAt({ height, coefficients: a }: Profile, phi: number) {
  let q = 0, dq = 0;
  for (let k = 0; k < a.length; k++) {
    q += a[k] * Math.cos(k * phi);
    dq -= k * a[k] * Math.sin(k * phi);
  }
  const sin = Math.sin(phi), cos = Math.cos(phi);
  return { radius: sin * q, dRadius: cos * q + sin * dq, y: (height / 2) * cos, dy: -(height / 2) * sin };
}

/** Fit the profile through `rings` (distinct positions strictly between 0 and 1, positive radii). */
export function fitProfile(height: number, rings: ProfileRing[]): ProfileFit {
  const w = rings.reduce((best, r, i) => (r.radius > rings[best].radius ? i : best), 0);
  const R = rings[w].radius;
  const K = MODES;
  const weight = Float64Array.from({ length: K }, (_, j) => (j + 1) ** 4);

  // Unknowns x_k = a_k / R for k = 1 … K; a_0 follows from passing through the widest ring:
  // q(φ)/R = Q0 + Σ x_k (cos kφ − cos kφw), with Q0 = 1 / sin φw. Each quantity below is constant + row · x.
  const fw = angleAt(rings[w].position);
  const Q0 = 1 / Math.sin(fw);
  const shift = (phi: number) => Float64Array.from({ length: K }, (_, j) => Math.cos((j + 1) * phi) - Math.cos((j + 1) * fw));
  /** ρ / R. */
  const radiusRow = (phi: number) => ({ row: shift(phi).map((x) => Math.sin(phi) * x), constant: Math.sin(phi) * Q0 });
  /** (dρ/dφ) / R. */
  const slopeRow = (phi: number) => {
    const s = shift(phi);
    return {
      row: s.map((x, j) => Math.cos(phi) * x - Math.sin(phi) * (j + 1) * Math.sin((j + 1) * phi)),
      constant: Math.cos(phi) * Q0,
    };
  };

  const level = slopeRow(fw);
  const equalities = [
    ...rings.flatMap((r, i) => {
      if (i === w) return [];
      const { row, constant } = radiusRow(angleAt(r.position));
      return [{ n: row, t: r.radius / R - constant }];
    }),
    { n: level.row, t: -level.constant },
  ];

  const nodes = Array.from({ length: NODES + 1 }, (_, m) => (Math.PI * m) / NODES);
  // One widest point: rising (dρ/dφ ≥ 0) above the widest ring, falling below it. At the poles that keeps q ≥ 0.
  const slopes = nodes.map(slopeRow);
  const rising = bounds(nodes.map((phi, m) => ({
    row: slopes[m].row,
    lo: phi < fw ? -slopes[m].constant : -Infinity,
    hi: phi > fw ? -slopes[m].constant : Infinity,
  })));
  // Otherwise: between the axis and the widest radius (0 ≤ ρ/R ≤ 1), still with q ≥ 0 at the poles.
  const capped = bounds(nodes.map((phi, m) => {
    if (m === 0) return { row: slopes[m].row, lo: -slopes[m].constant, hi: Infinity };
    if (m === NODES) return { row: slopes[m].row, lo: -Infinity, hi: -slopes[m].constant };
    const { row, constant } = radiusRow(phi);
    return { row, lo: -constant, hi: 1 - constant };
  }));

  const x = (unimodal(rings, w) ? minimumNorm(weight, equalities, rising) : null) ?? minimumNorm(weight, equalities, capped);
  if (!x) return { ok: false, ring: w };
  const coefficients = new Float64Array(K + 1);
  coefficients[0] = R * x.reduce((sum, xj, j) => sum - xj * Math.cos((j + 1) * fw), Q0);
  for (let j = 0; j < K; j++) coefficients[j + 1] = R * x[j];
  const profile = { height, coefficients };

  // Off the axis between the poles, and not pointed at them.
  const q0 = profileAt(profile, 0).dRadius, qPi = -profileAt(profile, Math.PI).dRadius;
  if (!(q0 > 0 && qPi > 0) || nodes.some((phi, m) => m > 0 && m < NODES && !(profileAt(profile, phi).radius > 0))) {
    return { ok: false, ring: w };
  }
  return { ok: true, profile, ellipsoid: x.every((xj) => Math.abs(xj) < 1e-9) };
}

/** One lo ≤ row · x ≤ hi per node, in the form `minimumNorm` takes. */
function bounds(perNode: { row: Float64Array; lo: number; hi: number }[]) {
  return {
    rows: perNode.map((b) => b.row),
    lo: Float64Array.from(perNode, (b) => b.lo),
    hi: Float64Array.from(perNode, (b) => b.hi),
  };
}

/** Whether the radii rise strictly from the top down to the widest ring and fall strictly after it. */
function unimodal(rings: ProfileRing[], w: number): boolean {
  const down = [...rings].sort((a, b) => b.position - a.position);
  const at = down.indexOf(rings[w]);
  return down.every((r, i) => i === 0 || (i <= at ? r.radius > down[i - 1].radius : r.radius < down[i - 1].radius));
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}


/**
 * The c with least Σ w_j c_j² such that n·c = t for each equality and lo_m ≤ rows_m·c ≤ hi_m for each bound;
 * null if there is none. Goldfarb–Idnani dual method: start from c = 0 and add violated constraints one at a
 * time, each by a step that keeps the added ones met and their multipliers of the right sign, dropping one
 * that would go wrong. The active normals stay linearly independent, so a flat stretch of the profile with
 * many touching bounds doesn't make it degenerate.
 */
function minimumNorm(
  w: Float64Array,
  equalities: { n: Float64Array; t: number }[],
  bounds: { rows: Float64Array[]; lo: Float64Array; hi: Float64Array },
): Float64Array | null {
  const n = w.length;
  const j0 = w.map((x) => 1 / Math.sqrt(x));
  const c = new Float64Array(n);
  /** Active constraints as a·c ≥ t (bounds) or a·c = t (equalities), with their multipliers u. */
  const active: { a: Float64Array; t: number; eq: boolean; key: number }[] = [];
  let u: number[] = [];

  /** Add a·c ≥ t (or = t). False if no c meets it along with the active ones. */
  const add = (a: Float64Array, t: number, eq: boolean, key: number): boolean => {
    let up = 0;
    for (let guard = 0; guard <= 2 * n + 2; guard++) {
      // J = J0 Q, with J0ᵀ N = Q [R; 0] for the active normals N.
      const q = active.length;
      const cols = active.map((r) => {
        const col = new Float64Array(n);
        for (let i = 0; i < n; i++) col[i] = r.a[i] * j0[i];
        return col;
      });
      const { Q, R } = householder(cols, n);
      const d = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const x = j0[i] * a[i];
        for (let k = 0; k < n; k++) d[k] += Q[i * n + k] * x;
      }
      // Primal direction z = J₂ d₂ (into the null space of the active normals) and dual direction r = R⁻¹ d₁.
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = q; k < n; k++) sum += Q[i * n + k] * d[k];
        z[i] = j0[i] * sum;
      }
      const r = new Array<number>(q).fill(0);
      for (let k = q - 1; k >= 0; k--) {
        let sum = d[k];
        for (let l = k + 1; l < q; l++) sum -= R[k * q + l] * r[l];
        r[k] = sum / R[k * q + k];
      }
      let d2 = 0;
      for (let k = q; k < n; k++) d2 += d[k] * d[k];
      const slack = dot(a, c) - t;
      const t2 = d2 > 1e-24 * dot(d, d) ? -slack / dot(z, a) : Infinity;
      let t1 = Infinity, drop = -1;
      for (let k = 0; k < q; k++) {
        if (!active[k].eq && r[k] > 0 && u[k] / r[k] < t1) [t1, drop] = [u[k] / r[k], k];
      }
      const step = Math.min(t1, t2);
      if (step === Infinity) return false;
      if (t2 !== Infinity) for (let i = 0; i < n; i++) c[i] += step * z[i];
      u = u.map((uk, k) => uk - step * r[k]);
      up += step;
      if (step === t2) {
        active.push({ a, t, eq, key });
        u.push(up);
        return true;
      }
      active.splice(drop, 1);
      u.splice(drop, 1);
    }
    return false;
  };

  const boundRow = (key: number) => {
    const m = key >> 1, upper = (key & 1) === 1;
    const t = upper ? -bounds.hi[m] : bounds.lo[m];
    return Number.isFinite(t) ? { a: upper ? bounds.rows[m].map((x) => -x) : bounds.rows[m], t, eq: false, key } : null;
  };
  for (const e of equalities) {
    const flip = dot(e.n, c) > e.t;
    if (!add(flip ? e.n.map((x) => -x) : e.n, flip ? -e.t : e.t, true, -1)) return null;
  }
  const tolerance = 1e-10;
  for (let round = 0; round < 4 * bounds.rows.length; round++) {
    const isActive = new Set(active.map((r) => r.key));
    let worst = -1, worstBy = tolerance, upper = false;
    for (let m = 0; m < bounds.rows.length; m++) {
      if (!Number.isFinite(bounds.lo[m]) && !Number.isFinite(bounds.hi[m])) continue;
      const v = dot(bounds.rows[m], c);
      if (bounds.lo[m] - v > worstBy && !isActive.has(2 * m)) [worst, worstBy, upper] = [m, bounds.lo[m] - v, false];
      if (v - bounds.hi[m] > worstBy && !isActive.has(2 * m + 1)) [worst, worstBy, upper] = [m, v - bounds.hi[m], true];
    }
    if (worst < 0) return c;
    const row = boundRow(2 * worst + (upper ? 1 : 0))!;
    if (!add(row.a, row.t, false, row.key)) return null;
  }
  return null;
}

/**
 * Full QR of the n×q matrix with the given columns by Householder reflections: Q (n×n, row-major, Q[i·n + k])
 * and R (q×q upper triangular, row-major).
 */
function householder(columns: Float64Array[], n: number): { Q: Float64Array; R: Float64Array } {
  const q = columns.length;
  // A[i·q + k]: row i, column k.
  const A = new Float64Array(n * q);
  for (let k = 0; k < q; k++) for (let i = 0; i < n; i++) A[i * q + k] = columns[k][i];
  const Q = new Float64Array(n * n);
  for (let i = 0; i < n; i++) Q[i * n + i] = 1;
  const v = new Float64Array(n);
  for (let k = 0; k < q; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += A[i * q + k] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = A[k * q + k] > 0 ? -norm : norm;
    let vv = 0;
    for (let i = k; i < n; i++) {
      v[i] = A[i * q + k] - (i === k ? alpha : 0);
      vv += v[i] * v[i];
    }
    if (vv === 0) continue;
    // A ← H A, Q ← Q H with H = I − 2 v vᵀ / vᵀv.
    for (let col = k; col < q; col++) {
      let s = 0;
      for (let i = k; i < n; i++) s += v[i] * A[i * q + col];
      s = (2 * s) / vv;
      for (let i = k; i < n; i++) A[i * q + col] -= s * v[i];
    }
    for (let row = 0; row < n; row++) {
      let s = 0;
      for (let i = k; i < n; i++) s += Q[row * n + i] * v[i];
      s = (2 * s) / vv;
      for (let i = k; i < n; i++) Q[row * n + i] -= s * v[i];
    }
  }
  const R = new Float64Array(q * q);
  for (let i = 0; i < q; i++) for (let k = i; k < q; k++) R[i * q + k] = A[i * q + k];
  return { Q, R };
}
