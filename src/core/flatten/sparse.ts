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

/**
 * Cholesky factorization of a symmetric positive definite matrix, for solving with the same matrix many
 * times (ARAP solves with one fixed matrix every iteration). Rows are reordered with reverse Cuthill–McKee
 * so the factor stays inside a narrow envelope (skyline storage): for mesh Laplacians this is fast and small.
 * Returns a solver for m·x = b.
 */
export function choleskySolver(m: CsrMatrix): (b: Float64Array) => Float64Array {
  const n = m.n;
  const perm = reverseCuthillMcKee(m); // new index → old index
  const inv = new Int32Array(n); // old index → new index
  perm.forEach((old, i) => (inv[old] = i));

  // Envelope: row i of the factor spans columns first[i]..i.
  const first = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let f = i;
    const old = perm[i];
    for (let k = m.rowPtr[old]; k < m.rowPtr[old + 1]; k++) f = Math.min(f, inv[m.col[k]]);
    first[i] = f;
  }
  const start = new Int32Array(n + 1); // row i's entries at start[i] .. start[i+1]-1, column first[i] + offset
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + (i - first[i] + 1);
  const L = new Float64Array(start[n]);
  for (let i = 0; i < n; i++) {
    const old = perm[i];
    for (let k = m.rowPtr[old]; k < m.rowPtr[old + 1]; k++) {
      const j = inv[m.col[k]];
      if (j <= i) L[start[i] + j - first[i]] += m.val[k];
    }
  }

  for (let i = 0; i < n; i++) {
    const fi = first[i], si = start[i];
    for (let j = fi; j <= i; j++) {
      const fj = first[j], sj = start[j];
      let s = L[si + j - fi];
      for (let k = Math.max(fi, fj); k < j; k++) s -= L[si + k - fi] * L[sj + k - fj];
      if (j < i) L[si + j - fi] = s / L[sj + j - fj];
      else L[si + i - fi] = Math.sqrt(Math.max(s, 1e-300));
    }
  }

  const y = new Float64Array(n);
  return (b) => {
    // Forward: L y = P b.
    for (let i = 0; i < n; i++) {
      const fi = first[i], si = start[i];
      let s = b[perm[i]];
      for (let k = fi; k < i; k++) s -= L[si + k - fi] * y[k];
      y[i] = s / L[si + i - fi];
    }
    // Backward: Lᵀ z = y, column-oriented over the rows of L.
    for (let i = n - 1; i >= 0; i--) {
      const fi = first[i], si = start[i];
      y[i] /= L[si + i - fi];
      const yi = y[i];
      for (let k = fi; k < i; k++) y[k] -= L[si + k - fi] * yi;
    }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[perm[i]] = y[i];
    return x;
  };
}

/** Reverse Cuthill–McKee ordering of the matrix graph, which keeps nonzeros near the diagonal. */
function reverseCuthillMcKee(m: CsrMatrix): Int32Array {
  const n = m.n;
  const degree = new Int32Array(n);
  for (let i = 0; i < n; i++) degree[i] = m.rowPtr[i + 1] - m.rowPtr[i];
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const byDegree = [...Array(n).keys()].sort((a, b) => degree[a] - degree[b]);
  for (const seed of byDegree) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    let head = order.length;
    order.push(seed);
    while (head < order.length) {
      const v = order[head++];
      const next: number[] = [];
      for (let k = m.rowPtr[v]; k < m.rowPtr[v + 1]; k++) {
        const w = m.col[k];
        if (!visited[w]) {
          visited[w] = 1;
          next.push(w);
        }
      }
      next.sort((a, b) => degree[a] - degree[b]);
      order.push(...next);
    }
  }
  return Int32Array.from(order.reverse());
}
