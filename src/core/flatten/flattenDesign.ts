import type { Projection } from "../projection/projection";
import type { Surface, SurfaceCoords, SurfaceSample, Vec3 } from "../surface/surface";
import type { Point2 } from "../types";
import { arapFlatten } from "./arap";
import { cutSlits, gridMesh, meshLocator, trimMesh, type TriangleMesh } from "./mesh";
import { convexHull, distanceToConvex } from "../geometry/polygon";

/** Cells across the longer side of the meshed patch: a few thousand triangles. */
const GRID_CELLS = 48;
/** Keep the mesh this far (radians of latitude) from the poles, where the surface coordinates pinch. */
const POLE_GAP = 0.05;

export interface FlatDesign {
  /** Design paths on paper: origin at the design center, +y toward the stem, physical units. */
  paths: Point2[][];
  /** The flattened mesh, for stretch and slits. `flat[i]` is the paper position of `mesh.vertices[i]`. */
  mesh: TriangleMesh;
  flat: Point2[];
  /**
   * Each slit on paper as an open polyline: in along one side of the cut to the tip and back out along
   * the other side (the sides part where the paper opens up). Runs out to the edge of the mesh.
   */
  slits: Point2[][];
}

/**
 * Chooses where to cut slits, given the uncut mesh and the design paths in the meshing domain.
 * Returns chains of edge-adjacent vertices from the mesh boundary to each slit's tip (see `cutSlits`).
 */
export type SlitPlanner = (mesh: TriangleMesh, design: Point2[][]) => number[][];

/**
 * Flatten the part of the surface the design covers. Meshes the surface around the design
 * (plus `padding` on every side) in a locally metric chart, flattens the mesh with ARAP, and carries
 * the design paths over through their barycentric position in each triangle.
 *
 * `center` is the design center in the front view; `paths` are placed front-view paths.
 * Returns null when the design center misses the surface or no design point lands on it.
 */
export function flattenDesign(
  surface: Surface,
  projection: Projection,
  center: Point2,
  paths: Point2[][],
  padding: number,
  planSlits?: SlitPlanner,
): FlatDesign | null {
  const centerHit = projection.project(center);
  if (!centerHit) return null;
  const chart = metricChart(surface, centerHit.coords);

  // First pass at a coarse step to size the patch, then densify design segments to the mesh spacing,
  // so straight front-view segments follow the surface instead of cutting across triangles.
  const coarse = toDomain(paths, projection, chart).flat();
  if (coarse.length === 0) return null;
  const xs = coarse.map((p) => p.x), ys = coarse.map((p) => p.y);
  const limits = chart.limits();
  const region = {
    minX: Math.max(limits.minX, Math.min(0, ...xs) - padding),
    maxX: Math.min(limits.maxX, Math.max(0, ...xs) + padding),
    minY: Math.max(limits.minY, Math.min(0, ...ys) - padding),
    maxY: Math.min(limits.maxY, Math.max(0, ...ys) + padding),
    spacing: 0,
  };
  region.spacing = Math.max(region.maxX - region.minX, region.maxY - region.minY) / GRID_CELLS;

  // Mesh only the covered part: the design's outline (with the center) grown by the padding.
  const covered = convexHull([{ x: 0, y: 0 }, ...coarse]);
  const grid = gridMesh(region, (p) => surface.sample(chart.toCoords(p)).point);
  const uncut = trimMesh(grid, (tri) => {
    const [a, b, c] = tri.map((i) => grid.domain[i]);
    return distanceToConvex({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, covered) <= padding;
  });
  const domainPaths = toDomain(densify(paths, region.spacing / 2), projection, chart);
  const chains = planSlits ? planSlits(uncut, domainPaths) : [];
  const { mesh, otherSide } = cutSlits(uncut, chains);
  const samples = mesh.domain.map((p) => surface.sample(chart.toCoords(p)));
  const raw = arapFlatten(mesh, { initial: azimuthalLayout(samples, surface, centerHit.coords) });
  const locate = meshLocator(mesh);
  const mapRaw = (p: Point2): Point2 | null => {
    const at = locate(p);
    if (!at) return null;
    const [a, b, c] = mesh.triangles[at.triangle].map((i) => raw[i]);
    const [w0, w1, w2] = at.weights;
    return { x: w0 * a.x + w1 * b.x + w2 * c.x, y: w0 * a.y + w1 * b.y + w2 * c.y };
  };

  // Align: design center to the origin, the direction toward the stem (+v on the surface) to +y.
  const origin = mapRaw({ x: 0, y: 0 });
  const up = mapRaw({ x: 0, y: region.spacing / 4 });
  if (!origin || !up) return null;
  const angle = Math.PI / 2 - Math.atan2(up.y - origin.y, up.x - origin.x);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const align = (p: Point2): Point2 => {
    const dx = p.x - origin.x, dy = p.y - origin.y;
    return { x: cos * dx - sin * dy, y: sin * dx + cos * dy };
  };
  const flat = raw.map(align);

  const flatPaths = domainPaths
    .map((path) => path.map(mapRaw).filter((p): p is Point2 => p !== null).map(align))
    .filter((path) => path.length >= 2);
  const slits = chains.map((chain, s) => [
    ...chain.map((v) => flat[v]),
    ...otherSide[s].slice(0, -1).reverse().map((v) => flat[v]),
  ]);
  return { paths: flatPaths, mesh, flat, slits };
}

/**
 * A chart of the surface around `center`: surface coordinates offset from the center and scaled
 * by the surface's local stretch factors, so domain lengths are close to true lengths nearby.
 */
function metricChart(surface: Surface, center: SurfaceCoords) {
  const h = 1e-5;
  const at = (du: number, dv: number) => surface.sample({ u: center.u + du, v: center.v + dv }).point;
  const p = at(0, 0);
  const su = Math.hypot(...at(h, 0).map((x, i) => x - p[i])) / h;
  const sv = Math.hypot(...at(0, h).map((x, i) => x - p[i])) / h;
  return {
    toDomain: ({ u, v }: SurfaceCoords): Point2 => ({ x: (u - center.u) * su, y: (v - center.v) * sv }),
    toCoords: ({ x, y }: Point2): SurfaceCoords => ({ u: center.u + x / su, v: center.v + y / sv }),
    /** Domain range that stays clear of the poles and of the longitude seam behind the pumpkin. */
    limits: () => ({
      minX: (-Math.PI + POLE_GAP - center.u) * su,
      maxX: (Math.PI - POLE_GAP - center.u) * su,
      minY: (-Math.PI / 2 + POLE_GAP - center.v) * sv,
      maxY: (Math.PI / 2 - POLE_GAP - center.v) * sv,
    }),
  };
}

/**
 * A fold-free starting layout close to the ARAP result: each vertex goes in its direction from the
 * center (in the tangent plane there, +u right, +v up) at roughly its distance along the surface.
 * The distance is the chord corrected by the turn of the normal, which is exact on a sphere.
 */
function azimuthalLayout(samples: SurfaceSample[], surface: Surface, center: SurfaceCoords): Point2[] {
  const h = 1e-5;
  const c = surface.sample(center);
  const n = c.normal;
  const tangent = (d: Vec3): Vec3 => {
    const k = dot(d, n);
    return normalize([d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]]);
  };
  const right = tangent(subtract(surface.sample({ u: center.u + h, v: center.v }).point, c.point));
  const along = tangent(subtract(surface.sample({ u: center.u, v: center.v + h }).point, c.point));
  const up = tangent(subtract(along, scale(right, dot(along, right))));

  return samples.map(({ point, normal }) => {
    const d = subtract(point, c.point);
    const chord = Math.hypot(...d);
    if (chord === 0) return { x: 0, y: 0 };
    const half = Math.acos(Math.max(-1, Math.min(1, dot(normal, n)))) / 2;
    const distance = half > 1e-9 ? (chord * half) / Math.sin(half) : chord;
    const x = dot(d, right), y = dot(d, up);
    const len = Math.hypot(x, y) || 1;
    return { x: (distance * x) / len, y: (distance * y) / len };
  });
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** Project front-view paths and express them in the chart; points that miss the surface are dropped. */
function toDomain(paths: Point2[][], projection: Projection, chart: ReturnType<typeof metricChart>): Point2[][] {
  return paths.map((path) =>
    path.flatMap((p) => {
      const hit = projection.project(p);
      return hit ? [chart.toDomain(hit.coords)] : [];
    }),
  );
}

/** Split each closed path's segments so no piece is longer than `step`; paths stay closed implicitly. */
function densify(paths: Point2[][], step: number): Point2[][] {
  return paths.map((path) =>
    path.flatMap((a, i) => {
      const b = path[(i + 1) % path.length];
      const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      return Array.from({ length: pieces }, (_, k) => ({
        x: a.x + ((b.x - a.x) * k) / pieces,
        y: a.y + ((b.y - a.y) * k) / pieces,
      }));
    }),
  );
}
