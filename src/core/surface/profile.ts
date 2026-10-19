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
 * close the profile at the base (ρ(L) = 0) and pass through every ring, found by minimum-norm Gauss–Newton.
 * Smoothest-first keeps symmetric data symmetric and gives a sphere back exactly from sphere rings.
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
// Gauss–Legendre, 3 points on [0, 1].
const GL_X = [0.5 - Math.sqrt(0.15), 0.5, 0.5 + Math.sqrt(0.15)];
const GL_W = [5 / 18, 8 / 18, 5 / 18];

/**
 * Fit the profile. `knots` are rings at known places. `widest` is the front-to-back radius at the profile's
 * widest point: at `widest.s` if given (the profile is then level there), otherwise wherever it turns out to be.
 */
export function fitProfile(length: number, knots: ProfileKnot[], widest: { rho: number; s?: number }): ProfileFit {
  const L = length;
  const M = INTERVALS;
  const h = L / M;
  const constraints = 1 + knots.length + (widest.s === undefined ? 1 : 2);
  const J = Math.max(MIN_MODES, constraints + 8);
  const weight = Array.from({ length: J }, (_, j) => (j + 1) ** 4);

  // Quadrature nodes and the basis there.
  const nq = 3 * M;
  const qs = new Float64Array(nq);
  for (let m = 0; m < M; m++) for (let k = 0; k < 3; k++) qs[3 * m + k] = (m + GL_X[k]) * h;
  const basis = Array.from({ length: J }, (_, j) => qs.map((s) => Math.sin(((j + 1) * Math.PI * s) / L)));

  const thetaAt = (c: Float64Array, s: number) => {
    let t = (Math.PI * s) / L;
    for (let j = 0; j < J; j++) t += c[j] * Math.sin(((j + 1) * Math.PI * s) / L);
    return t;
  };

  /** ρ(s) and its gradient in c, from the tables at interval ends plus a partial interval. */
  interface State {
    c: Float64Array;
    cos: Float64Array;
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
    return { c, cos, sin, F, G };
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
    if (widest.s === undefined) {
      // Envelope: at the widest point dρ/ds = 0, so moving it doesn't change ρ there to first order.
      const { value, grad } = evaluate(st, widestPoint(st));
      r[constraints - 1] = value - widest.rho;
      A.push(grad);
    } else {
      const { value, grad } = evaluate(st, widest.s);
      r[constraints - 2] = value - widest.rho;
      A.push(grad);
      // Level there: θ = π/2 (scaled by L/π to a length, like the other residuals).
      r[constraints - 1] = ((thetaAt(st.c, widest.s) - Math.PI / 2) * L) / Math.PI;
      A.push(Float64Array.from({ length: J }, (_, j) => (Math.sin(((j + 1) * Math.PI * widest.s!) / L) * L) / Math.PI));
    }
    return { r, A };
  };
  const norm = (r: Float64Array) => Math.max(...r.map(Math.abs));

  let st = state(new Float64Array(J));
  let { r, A } = residuals(st);
  const tolerance = 1e-10 * L;
  for (let it = 0; it < MAX_ITERATIONS && norm(r) > tolerance; it++) {
    // Minimum-norm step: c' = W⁻¹Aᵀ (A W⁻¹ Aᵀ)⁻¹ (A c − r).
    const K = A.length;
    const S = Array.from({ length: K }, (_, p) =>
      Array.from({ length: K }, (_, q) => {
        let sum = 0;
        for (let j = 0; j < J; j++) sum += (A[p][j] * A[q][j]) / weight[j];
        return sum;
      }),
    );
    const rhs = A.map((row, p) => row.reduce((sum, a, j) => sum + a * st.c[j], 0) - r[p]);
    const lambda = solve(S, rhs);
    if (!lambda) return { ok: false, at: L / 2 };
    const target = new Float64Array(J);
    for (let j = 0; j < J; j++) {
      let sum = 0;
      for (let p = 0; p < K; p++) sum += A[p][j] * lambda[p];
      target[j] = sum / weight[j];
    }
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
    const at = worst === 0 ? L : worst <= knots.length ? knots[worst - 1].s : (widest.s ?? widestPoint(st));
    return { ok: false, at };
  }

  // Tables at the interval ends.
  const s = new Float64Array(M + 1), drho = new Float64Array(M + 1), dy = new Float64Array(M + 1), y = new Float64Array(M + 1);
  for (let m = 0; m <= M; m++) {
    s[m] = m * h;
    const t = thetaAt(st.c, s[m]);
    drho[m] = Math.cos(t);
    dy[m] = -Math.sin(t);
    // The profile must keep heading down (no overhang folding back up) and stay off the axis in between.
    if (dy[m] > 1e-9 || (m > 0 && m < M && !(st.F[m] > 0))) return { ok: false, at: s[m] };
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
