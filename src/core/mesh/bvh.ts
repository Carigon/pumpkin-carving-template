import type { Vec3 } from "../surface/surface";
import type { SurfaceMesh } from "../types";

/** Where a ray first meets the mesh: distance along it, the triangle, and the barycentric weights there. */
export interface RayHit {
  t: number;
  triangle: number;
  /** Weights of the triangle's three corners; they sum to 1. */
  weights: [number, number, number];
}

export interface Bvh {
  /** Nearest hit of the ray origin + t·direction with t > 0, or null. */
  raycast(origin: Vec3, direction: Vec3): RayHit | null;
}

/** Triangles per leaf. */
const LEAF_SIZE = 4;
/** Slack on the barycentric bounds, so a ray through a shared edge or corner can't slip between triangles. */
const EDGE_SLACK = 1e-9;

/** A bounding volume hierarchy over the mesh's triangles: axis-aligned boxes, split at the median along the longest side. */
export function buildBvh({ positions, triangles }: SurfaceMesh): Bvh {
  const count = triangles.length / 3;
  const order = Uint32Array.from({ length: count }, (_, i) => i);
  const centroids = new Float64Array(3 * count);
  const boxes = new Float64Array(6 * count);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      let lo = Infinity, hi = -Infinity;
      for (let c = 0; c < 3; c++) {
        const x = positions[3 * triangles[3 * t + c] + k];
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      boxes[6 * t + k] = lo;
      boxes[6 * t + 3 + k] = hi;
      centroids[3 * t + k] = (lo + hi) / 2;
    }
  }

  // Nodes: box (min xyz, max xyz); an inner node's children are `left` and `left + 1`, a leaf holds order[start, start + size).
  // A tree over n triangles has fewer than 2n nodes; typed arrays keep the ray casts' lookups fast.
  const maxNodes = Math.max(1, 2 * count);
  const nodeBoxes = new Float64Array(6 * maxNodes);
  const left = new Int32Array(maxNodes);
  const start = new Uint32Array(maxNodes);
  const size = new Uint32Array(maxNodes);
  let nodeCount = 1;

  const build = (node: number, from: number, to: number) => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const spread = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = from; i < to; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], boxes[6 * t + k]);
        box[3 + k] = Math.max(box[3 + k], boxes[6 * t + 3 + k]);
        spread[k] = Math.min(spread[k], centroids[3 * t + k]);
        spread[3 + k] = Math.max(spread[3 + k], centroids[3 * t + k]);
      }
    }
    box.forEach((x, k) => (nodeBoxes[6 * node + k] = x));
    if (to - from <= LEAF_SIZE) {
      [left[node], start[node], size[node]] = [-1, from, to - from];
      return;
    }
    const axis = [0, 1, 2].reduce((a, k) => (spread[3 + k] - spread[k] > spread[3 + a] - spread[a] ? k : a), 0);
    const mid = (from + to) >> 1;
    splitAt(order, from, to, mid, (t) => centroids[3 * t + axis]);
    const child = nodeCount;
    nodeCount += 2;
    left[node] = child;
    build(child, from, mid);
    build(child + 1, mid, to);
  };
  if (count > 0) build(0, 0, count);

  /**
   * Möller–Trumbore: distance along the ray to triangle t and the weights there, or null if it misses. Written out
   * on the flat arrays rather than with the `Vec3` helpers: this is the inner loop of every ray cast.
   */
  const intersect = (t: number, o: Vec3, d: Vec3): RayHit | null => {
    const a = 3 * triangles[3 * t], b = 3 * triangles[3 * t + 1], c = 3 * triangles[3 * t + 2];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-300) return null;
    const s = [o[0] - positions[a], o[1] - positions[a + 1], o[2] - positions[a + 2]];
    const w1 = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (w1 < -EDGE_SLACK || w1 > 1 + EDGE_SLACK) return null;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const w2 = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (w2 < -EDGE_SLACK || w1 + w2 > 1 + EDGE_SLACK) return null;
    const along = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    return along > 0 ? { t: along, triangle: t, weights: [1 - w1 - w2, w1, w2] } : null;
  };

  /** Distance along the ray to where it enters the node's box, or Infinity if it misses it. */
  const entry = (node: number, o: Vec3, d: Vec3): number => {
    let near = 0, far = Infinity;
    for (let k = 0; k < 3; k++) {
      const lo = nodeBoxes[6 * node + k], hi = nodeBoxes[6 * node + 3 + k];
      if (d[k] === 0) {
        if (o[k] < lo || o[k] > hi) return Infinity;
        continue;
      }
      let t0 = (lo - o[k]) / d[k], t1 = (hi - o[k]) / d[k];
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      if (near > far) return Infinity;
    }
    return near;
  };

  return {
    raycast(origin, direction) {
      if (count === 0) return null;
      let best: RayHit | null = null;
      // Nodes still to visit, with the distance to where the ray enters each; the nearer child is visited first.
      const stack = [0];
      const enters = [entry(0, origin, direction)];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (enters.pop()! > (best?.t ?? Infinity)) continue;
        if (left[node] >= 0) {
          const a = left[node], b = a + 1;
          const ta = entry(a, origin, direction), tb = entry(b, origin, direction);
          const [near, far, tNear, tFar] = ta <= tb ? [a, b, ta, tb] : [b, a, tb, ta];
          if (tFar < Infinity) {
            stack.push(far);
            enters.push(tFar);
          }
          if (tNear < Infinity) {
            stack.push(near);
            enters.push(tNear);
          }
          continue;
        }
        for (let i = start[node]; i < start[node] + size[node]; i++) {
          const hit = intersect(order[i], origin, direction);
          if (hit && hit.t < (best?.t ?? Infinity)) best = hit;
        }
      }
      return best;
    },
  };
}

/**
 * Reorder items[from, to) so that items[k] is the one that would be there if sorted by `key`, with none larger before
 * it and none smaller after (quickselect).
 */
function splitAt(items: Uint32Array, from: number, to: number, k: number, key: (item: number) => number): void {
  let lo = from, hi = to - 1;
  while (lo < hi) {
    const pivot = key(items[(lo + hi) >> 1]);
    let i = lo, j = hi;
    while (i <= j) {
      while (key(items[i]) < pivot) i++;
      while (key(items[j]) > pivot) j--;
      if (i <= j) {
        [items[i], items[j]] = [items[j], items[i]];
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}
