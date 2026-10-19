/** Symmetric sparse matrix in compressed sparse row form. */
export interface CsrMatrix {
  n: number;
  rowPtr: Int32Array;
  col: Int32Array;
  val: Float64Array;
}

/** Accumulates entries (duplicates add up), then freezes them into CSR. */
export function sparseBuilder(n: number) {
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  return {
    add(i: number, j: number, v: number) {
      rows[i].set(j, (rows[i].get(j) ?? 0) + v);
    },
    build(): CsrMatrix {
      const rowPtr = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i] + rows[i].size;
      const col = new Int32Array(rowPtr[n]);
      const val = new Float64Array(rowPtr[n]);
      rows.forEach((row, i) => {
        let k = rowPtr[i];
        for (const [j, v] of [...row].sort((x, y) => x[0] - y[0])) {
          col[k] = j;
          val[k++] = v;
        }
      });
      return { n, rowPtr, col, val };
    },
  };
}

function multiply(m: CsrMatrix, x: Float64Array, out: Float64Array): void {
  for (let i = 0; i < m.n; i++) {
    let s = 0;
    for (let k = m.rowPtr[i]; k < m.rowPtr[i + 1]; k++) s += m.val[k] * x[m.col[k]];
    out[i] = s;
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Jacobi-preconditioned conjugate gradients for a symmetric positive definite system.
 * Solves m·x = b in place, starting from the given x (warm start).
 */
export function solvePcg(m: CsrMatrix, b: Float64Array, x: Float64Array, tol = 1e-10, maxIterations = 1000): void {
  const n = m.n;
  const diagInv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = m.rowPtr[i]; k < m.rowPtr[i + 1]; k++) if (m.col[k] === i) diagInv[i] = 1 / m.val[k];
  }
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const ap = new Float64Array(n);
  multiply(m, x, ap);
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - ap[i];
    z[i] = diagInv[i] * r[i];
    p[i] = z[i];
  }
  let rz = dot(r, z);
  const limit = tol * Math.sqrt(dot(b, b));
  for (let it = 0; it < maxIterations && Math.sqrt(dot(r, r)) > limit; it++) {
    multiply(m, p, ap);
    const alpha = rz / dot(p, ap);
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
      z[i] = diagInv[i] * r[i];
    }
    const rzNew = dot(r, z);
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
}
