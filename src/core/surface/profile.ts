/**
 * Smooth side profile through tape rings, as a front meridian parameterized by arc length s ∈ [0, L]
 * from the stem (s = 0) to the base (s = L).
 *
 * The meridian's direction is an angle θ(s) turning from 0 at the stem (heading straight out, away from the
 * axis) to π at the base (heading straight back in): dρ/ds = cos θ, dy/ds = −sin θ. So |dρ/ds| ≤ 1 holds by
 * construction, the arc length is exactly L, and the surface meets the axis smoothly at both ends.
 *
 *   θ(s) = π s / L + Σ_j c_j sin(j π s / L)
 *
 * With every c_j = 0 this is a sphere of circumference 2L. The c_j are the smoothest (least Σ j⁴ c_j²) that
 * close the profile at the base (ρ(L) = 0) and pass through every ring, found by Gauss–Newton with each step
 * a small quadratic program. θ is linear in the c_j, so two shape rules are exact linear inequalities:
 *
 * - No fold: 0 ≤ θ ≤ π everywhere, so the profile keeps heading down (no overhang).
 * - One widest point: θ ≤ π/2 above the widest point and θ ≥ π/2 below it, so the radius only grows down to
 *   the widest ring and only shrinks after it. The widest ring is then a true maximum, where it was measured.
 *   Without these, the smoothest θ overshoots: a barrel bulges out past the widest ring on either side of it.
 *
 * When the widest point's place isn't given, it goes wherever the profile is smoothest. Smoothest-first gives a
 * sphere back exactly from sphere rings. (Rings that rise and fall more than once can't have one widest point;
 * they get the smoothest profile that is widest at its own widest point, as wide as the widest ring.)
 */

/** A point the profile must pass through: front-to-back radius `rho` at arc length `s` from the stem. */
export interface ProfileKnot {
  s: number;
  rho: number;
}

export interface ProfileTable {
  /** Front arc length L. */
  length: number;
  /** Node arc lengths, 0 … L, evenly spaced. */
  s: Float64Array;
  /** Front-to-back radius ρ at each node. */
  rho: Float64Array;
  /** Height y at each node, 0 at mid-height (stem up). */
  y: Float64Array;
  /** dρ/ds = cos θ and dy/ds = −sin θ at each node, for cubic Hermite interpolation between nodes. */
  drho: Float64Array;
  dy: Float64Array;
}

export type ProfileFit =
  | { ok: true; table: ProfileTable }
  /** `at`: arc length where the fit went wrong (fold or no convergence), to blame the nearest ring. */
  | { ok: false; at: number };

const INTERVALS = 256;
const MIN_MODES = 16;
const MAX_ITERATIONS = 60;
/** How closely the widest point's place is found when it isn't given, as a fraction of the arc. */
const WIDEST_TOLERANCE = 3e-3;
// Gauss–Legendre, 3 points on [0, 1].
const GL_X = [0.5 - Math.sqrt(0.15), 0.5, 0.5 + Math.sqrt(0.15)];
const GL_W = [5 / 18, 8 / 18, 5 / 18];

/**
 * Fit the profile. `knots` are rings at known places. `widest` is the front-to-back radius at the profile's
 * widest point: at `widest.s` if given, otherwise wherever it turns out to be.
 */
export function fitProfile(length: number, knots: ProfileKnot[], widest: { rho: number; s?: number }): ProfileFit {
  const L = length;
  const R = widest.rho;
  const constraints = 1 + knots.length + (widest.s === undefined ? 1 : 2);
  const model = profileModel(L, Math.max(MIN_MODES, constraints + 8));
  const sorted = [...knots].sort((a, b) => a.s - b.s);

  if (widest.s !== undefined) {
    const fit = unimodal(sorted, R, widest.s) ? model.fit(knots, R, widest.s, true) : model.fit(knots, R, widest.s, false);
    return fit.ok ? model.table(fit.c) : fit;
  }

  // The smoothest profile with its widest point wherever it lands: if that already has a single widest point,
  // the rule changes nothing.
  const free = model.fit(knots, R, undefined, false);
  if (free.ok && model.single(free.c)) return model.table(free.c);

  // Otherwise search for the widest point's place. It can go between two neighbouring knots (poles included),
  // far enough from each for the radius to reach R, with the rings rising before it and falling after it.
  const poles = [{ s: 0, rho: 0 }, ...sorted, { s: L, rho: 0 }];
  let best: { c: Float64Array; energy: number } | null = null;
  for (let i = 0; i + 1 < poles.length; i++) {
    const lo = poles[i].s + (R - poles[i].rho), hi = poles[i + 1].s - (R - poles[i + 1].rho);
    if (!(hi > lo) || !unimodal(sorted, R, (poles[i].s + poles[i + 1].s) / 2)) continue;
    // Golden-section search for the smoothest place, keeping clear of the ends where the profile would have to
    // run straight out (|dρ/ds| = 1).
    const margin = 0.02 * (hi - lo);
    const energyAt = (s: number) => {
      // Starting from the best fit so far is quicker; from scratch if that fails.
      let fit = model.fit(knots, R, s, true, best?.c);
      if (!fit.ok && best) fit = model.fit(knots, R, s, true);
      if (fit.ok && (!best || fit.energy < best.energy)) best = fit;
      return fit.ok ? fit.energy : Infinity;
    };
    const g = (Math.sqrt(5) - 1) / 2;
    let a = lo + margin, b = hi - margin;
    let x1 = b - g * (b - a), x2 = a + g * (b - a);
    let f1 = energyAt(x1), f2 = energyAt(x2);
    while (b - a > WIDEST_TOLERANCE * L) {
      if (f1 <= f2) {
        [b, x2, f2] = [x2, x1, f1];
        x1 = b - g * (b - a);
        f1 = energyAt(x1);
      } else {
        [a, x1, f1] = [x1, x2, f2];
        x2 = a + g * (b - a);
        f2 = energyAt(x2);
      }
    }
  }
  if (best) return model.table((best as { c: Float64Array }).c);
  // Rings that go up and down: keep the profile that is widest where it is widest.
  return free.ok ? model.table(free.c) : free;
}

/** Whether the rings rise strictly to below R before `at` and fall strictly after it. */
function unimodal(sorted: ProfileKnot[], R: number, at: number): boolean {
  for (let i = 0; i < sorted.length; i++) {
    if (!(sorted[i].rho < R) || sorted[i].s === at) return false;
    if (i > 0 && sorted[i].s <= at && !(sorted[i].rho > sorted[i - 1].rho)) return false;
    if (i > 0 && sorted[i - 1].s >= at && !(sorted[i].rho < sorted[i - 1].rho)) return false;
  }
  return true;
}

type Fit = { ok: true; c: Float64Array; energy: number } | { ok: false; at: number };

/** The θ(s) series with J modes on [0, L], and fitting it. */
function profileModel(L: number, J: number) {
  const M = INTERVALS;
  const h = L / M;
  const weight = Float64Array.from({ length: J }, (_, j) => (j + 1) ** 4);

  // Quadrature nodes and the basis there.
  const nq = 3 * M;
  const qs = new Float64Array(nq);
  for (let m = 0; m < M; m++) for (let k = 0; k < 3; k++) qs[3 * m + k] = (m + GL_X[k]) * h;
  const basis = Array.from({ length: J }, (_, j) => qs.map((s) => Math.sin(((j + 1) * Math.PI * s) / L)));
  const modesAt = (s: number) => Float64Array.from({ length: J }, (_, j) => Math.sin(((j + 1) * Math.PI * s) / L));
  /** θ − π s / L = nodeModes[m] · c at the interior table nodes. */
  const nodeModes = Array.from({ length: M + 1 }, (_, m) => modesAt(m * h));

  const thetaAt = (c: Float64Array, s: number) => {
    let t = (Math.PI * s) / L;
    for (let j = 0; j < J; j++) t += c[j] * Math.sin(((j + 1) * Math.PI * s) / L);
    return t;
  };

  /** ρ(s) and its gradient in c, from the tables at interval ends plus a partial interval. */
  interface State {
    c: Float64Array;
    sin: Float64Array;
    /** ρ at interval ends (M + 1). */
    F: Float64Array;
    /** ∂ρ/∂c_j at interval ends: G[j][m]. */
    G: Float64Array[];
  }
  const state = (c: Float64Array): State => {
    const cos = new Float64Array(nq), sin = new Float64Array(nq);
    for (let q = 0; q < nq; q++) {
      let t = (Math.PI * qs[q]) / L;
      for (let j = 0; j < J; j++) t += c[j] * basis[j][q];
      cos[q] = Math.cos(t);
      sin[q] = Math.sin(t);
    }
    const F = new Float64Array(M + 1);
    for (let m = 0; m < M; m++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += GL_W[k] * cos[3 * m + k];
      F[m + 1] = F[m] + sum * h;
    }
    const G = basis.map((phi) => {
      const g = new Float64Array(M + 1);
      for (let m = 0; m < M; m++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += GL_W[k] * sin[3 * m + k] * phi[3 * m + k];
        g[m + 1] = g[m] - sum * h;
      }
      return g;
    });
    return { c, sin, F, G };
  };
  /** ρ(s) and ∂ρ/∂c at any s. */
  const evaluate = (st: State, s: number): { value: number; grad: Float64Array } => {
    const m = Math.min(M - 1, Math.max(0, Math.floor(s / h)));
    const a = m * h, w = s - a;
    let value = st.F[m];
    const grad = new Float64Array(J);
    for (let j = 0; j < J; j++) grad[j] = st.G[j][m];
    if (w !== 0) {
      for (let k = 0; k < 3; k++) {
        const x = a + GL_X[k] * w;
        const t = thetaAt(st.c, x);
        value += GL_W[k] * w * Math.cos(t);
        for (let j = 0; j < J; j++) grad[j] -= GL_W[k] * w * Math.sin(t) * Math.sin(((j + 1) * Math.PI * x) / L);
      }
    }
    return { value, grad };
  };
  /** Where the profile is widest: θ = π/2, in the interval with the largest ρ where cos θ turns negative. */
  const widestPoint = (st: State): number => {
    let best = -1, bestRho = -Infinity;
    for (let m = 0; m < M; m++) {
      const c0 = Math.cos(thetaAt(st.c, m * h)), c1 = Math.cos(thetaAt(st.c, (m + 1) * h));
      if (c0 >= 0 && c1 < 0 && Math.max(st.F[m], st.F[m + 1]) > bestRho) {
        best = m;
        bestRho = Math.max(st.F[m], st.F[m + 1]);
      }
    }
    if (best < 0) return L / 2;
    let lo = best * h, hi = (best + 1) * h;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (Math.cos(thetaAt(st.c, mid)) >= 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  /** Bounds active in the last quadratic program, to start the next one from. */
  let lastActive: number[] = [];

  /**
   * The smoothest profile through the knots with widest radius R, at `at` if given (level there), otherwise
   * at the profile's own widest point. `single`: one widest point at `at`, rising before it and falling after.
   */
  const fit = (knots: ProfileKnot[], R: number, at: number | undefined, single: boolean, from?: Float64Array): Fit => {
    const constraints = 1 + knots.length + (at === undefined ? 1 : 2);
    // Bounds on θ − π s / L at the interior table nodes.
    const lo = new Float64Array(M + 1).fill(-Infinity), hi = new Float64Array(M + 1).fill(Infinity);
    for (let m = 1; m < M; m++) {
      const s = m * h, sphere = (Math.PI * s) / L;
      const below = single && at !== undefined && s > at, above = single && at !== undefined && s < at;
      const skip = single && at !== undefined && Math.abs(s - at) < 1e-9 * L;
      lo[m] = skip ? -Infinity : (below ? Math.PI / 2 : 0) - sphere;
      hi[m] = skip ? Infinity : (above ? Math.PI / 2 : Math.PI) - sphere;
    }
    const bounds = { rows: nodeModes, lo, hi };
    // Level at the widest point: θ = π/2 (scaled by L/π to a length, like the other residuals). Linear in c.
    const levelRow = at === undefined ? null : modesAt(at).map((x) => (x * L) / Math.PI);
    const levelTarget = at === undefined ? 0 : L / 2 - at;

    const residuals = (st: State): { r: Float64Array; A: Float64Array[] } => {
      const r = new Float64Array(constraints);
      const A: Float64Array[] = [];
      r[0] = st.F[M];
      A.push(Float64Array.from(st.G, (g) => g[M]));
      knots.forEach((knot, i) => {
        const { value, grad } = evaluate(st, knot.s);
        r[1 + i] = value - knot.rho;
        A.push(grad);
      });
      if (at === undefined) {
        // Envelope: at the widest point dρ/ds = 0, so moving it doesn't change ρ there to first order.
        const { value, grad } = evaluate(st, widestPoint(st));
        r[constraints - 1] = value - R;
        A.push(grad);
      } else {
        const { value, grad } = evaluate(st, at);
        r[constraints - 2] = value - R;
        A.push(grad);
        r[constraints - 1] = dot(levelRow!, st.c) - levelTarget;
        A.push(levelRow!);
      }
      return { r, A };
    };
    const norm = (r: Float64Array) => Math.max(...r.map(Math.abs));

    // Start where the shape rules hold, so every step (a blend of two such points) keeps them: the smoothest
    // such θ, or, from a nearby fit `from`, the least change to it that keeps them (c = from + δ).
    const c0 = from ?? new Float64Array(J);
    const shifted = { rows: nodeModes, lo: lo.map((x, m) => x - dot(nodeModes[m], c0)), hi: hi.map((x, m) => x - dot(nodeModes[m], c0)) };
    const start = levelRow ? minimumNorm(weight, [{ n: levelRow, t: levelTarget - dot(levelRow, c0) }], shifted, from ? [] : lastActive) : null;
    if (levelRow && !start) return { ok: false, at: at ?? L / 2 };
    if (start && !from) lastActive = start.active;
    let st = state(start ? c0.map((x, j) => x + start.c[j]) : c0);
    let { r, A } = residuals(st);
    const tolerance = 1e-10 * L;
    for (let it = 0; it < MAX_ITERATIONS && norm(r) > tolerance; it++) {
      // Smoothest c with the linearized constraints met: A c = A c_k − r.
      const qp = minimumNorm(weight, A.map((n, p) => ({ n, t: dot(n, st.c) - r[p] })), bounds, lastActive);
      if (!qp) return { ok: false, at: at ?? L / 2 };
      const target = qp.c;
      lastActive = qp.active;
      // Damped: halve the step until the residual drops.
      let step = 1;
      let next = st, nextRes = { r, A };
      for (let tries = 0; tries < 12; tries++, step /= 2) {
        const c = st.c.map((cj, j) => cj + step * (target[j] - cj));
        next = state(c);
        nextRes = residuals(next);
        if (norm(nextRes.r) < norm(r)) break;
      }
      if (!(norm(nextRes.r) < norm(r))) break;
      st = next;
      ({ r, A } = nextRes);
    }
    if (!(norm(r) <= 1e-7 * L)) {
      // Blame the constraint that is furthest off.
      let worst = 0;
      r.forEach((x, i) => (Math.abs(x) > Math.abs(r[worst]) ? (worst = i) : 0));
      return { ok: false, at: worst === 0 ? L : worst <= knots.length ? knots[worst - 1].s : (at ?? widestPoint(st)) };
    }
    // The profile must keep heading down (no overhang folding back up) and stay off the axis in between.
    for (let m = 0; m <= M; m++) {
      if (-Math.sin(thetaAt(st.c, m * h)) > 1e-9 || (m > 0 && m < M && !(st.F[m] > 0))) return { ok: false, at: m * h };
    }
    let energy = 0;
    for (let j = 0; j < J; j++) energy += weight[j] * st.c[j] ** 2;
    return { ok: true, c: st.c, energy };
  };

  /** Tables at the interval ends. */
  const table = (c: Float64Array): ProfileFit => {
    const st = state(c);
    const s = new Float64Array(M + 1), drho = new Float64Array(M + 1), dy = new Float64Array(M + 1), y = new Float64Array(M + 1);
    for (let m = 0; m <= M; m++) {
      s[m] = m * h;
      const t = thetaAt(c, s[m]);
      drho[m] = Math.cos(t);
      dy[m] = -Math.sin(t);
      if (m > 0) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += GL_W[k] * st.sin[3 * (m - 1) + k];
        y[m] = y[m - 1] - sum * h;
      }
    }
    const half = -y[M] / 2;
    for (let m = 0; m <= M; m++) y[m] += half;
    const rho = st.F.slice();
    rho[0] = 0;
    rho[M] = 0;
    return { ok: true, table: { length: L, s, rho, y, drho, dy } };
  };

  /** Whether the profile rises to its widest point and falls after it, with nothing else as wide. */
  const single = (c: Float64Array): boolean => {
    const at = widestPoint(state(c));
    for (let m = 1; m < M; m++) {
      const t = thetaAt(c, m * h);
      if (m * h < at ? t > Math.PI / 2 + 1e-9 : t < Math.PI / 2 - 1e-9) return false;
    }
    return true;
  };

  return { fit, table, single };
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Σ a_j b_j / w_j. */
function dotOver(a: ArrayLike<number>, b: ArrayLike<number>, w: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] * b[i]) / w[i];
  return sum;
}

/**
 * The c with least Σ w_j c_j² such that n·c = t for each equality and lo_m ≤ rows_m·c ≤ hi_m for each bound;
 * null if there is none. Goldfarb–Idnani dual method: start from c = 0 and add violated constraints one at a
 * time, each by a step that keeps the added ones met and their multipliers of the right sign, dropping one
 * that would go wrong. The active normals stay linearly independent, so a flat stretch of the profile with
 * many touching bounds doesn't make it degenerate.
 *
 * `warm`: bounds that were active last time (as returned in `active`). Starting from them, minus any whose
 * multipliers come out wrong, saves re-adding them one by one when the problem has barely changed.
 */
function minimumNorm(
  w: Float64Array,
  equalities: { n: Float64Array; t: number }[],
  bounds: { rows: Float64Array[]; lo: Float64Array; hi: Float64Array },
  warm: number[] = [],
): { c: Float64Array; active: number[] } | null {
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
  // Warm start: the least c meeting the equalities and the warm bounds exactly, dropping the bound with the
  // most negative multiplier until none is negative. That is a valid starting point for the dual method.
  let start = [...equalities.map((e) => ({ a: e.n, t: e.t, eq: true, key: -1 })), ...warm.flatMap((k) => boundRow(k) ?? [])];
  while (start.length > equalities.length) {
    const H = start.map((p) => start.map((q) => dotOver(p.a, q.a, w)));
    const lambda = solve(H, start.map((p) => p.t));
    if (!lambda) break;
    let worst = -1;
    lambda.forEach((l, i) => (!start[i].eq && l < 0 && (worst < 0 || l < lambda[worst]) ? (worst = i) : 0));
    if (worst < 0) {
      start.forEach((p, i) => {
        for (let j = 0; j < n; j++) c[j] += (lambda[i] * p.a[j]) / w[j];
      });
      active.push(...start);
      u = lambda;
      break;
    }
    start.splice(worst, 1);
  }
  if (active.length === 0) {
    for (const e of equalities) {
      const flip = dot(e.n, c) > e.t;
      if (!add(flip ? e.n.map((x) => -x) : e.n, flip ? -e.t : e.t, true, -1)) return null;
    }
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
    if (worst < 0) return { c, active: active.filter((r) => !r.eq).map((r) => r.key) };
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

/** Gaussian elimination with partial pivoting; null if singular. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-300) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const f = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}
