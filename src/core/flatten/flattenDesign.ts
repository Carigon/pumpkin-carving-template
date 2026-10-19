import { signedArea } from "../geometry/distanceField";
import { barycentric, centroid, distance, dot3, length3, normalize3, polylineLength, scale3, sub3 } from "../geometry/vector";
import type { Projection } from "../projection/projection";
import type { Surface, SurfaceCoords, SurfaceSample, Vec3 } from "../surface/surface";
import { cutRegion } from "../template/cutOutline";
import { finishSlits, planSlits, type SlitPlanOptions } from "../template/slits";
import type { Point2 } from "../types";
import { arapFlatten } from "./arap";
import { cutSlits, gridMesh, meshLocator, trimMesh, type MeshLocator, type TriangleMesh } from "./mesh";

/** Mesh cells (two triangles each) over the paper: a few thousand triangles. */
const MESH_CELLS = 1500;
/** Design segments are split into at least this many pieces across the design. */
const DESIGN_STEPS = 100;
/**
 * Keep the mesh this fraction of the coordinate range away from its edges, where the coordinates pinch
 * (poles) or wrap (seam). 0.05 rad of latitude, as before, on the latitude range π.
 */
const EDGE_GAP = 0.05 / Math.PI;
/** The mesh reaches this many margins past the cut-out edge, so the edge and the slit ends sit inside it. */
const MESH_OVERHANG = 0.5;

export interface FlattenOptions {
  surface: Surface;
  projection: Projection;
  /** The design center in the front view. */
  center: Point2;
  /** Placed front-view design paths (closed). */
  paths: Point2[][];
  /** Paper margin between the design and the cut-out edge. */
  margin: number;
  slits: SlitPlanOptions;
}

export interface FlatDesign {
  /** Design paths on paper: origin at the design center, +y toward the stem, physical units. */
  paths: Point2[][];
  /** The flattened mesh, for stretch. `flat[i]` is the paper position of `mesh.vertices[i]`. */
  mesh: TriangleMesh;
  flat: Point2[];
  /** Outward surface normal at each mesh vertex. */
  normals: Vec3[];
  /** The cut-out edge on paper: the design's outline grown by the margin (see `cutRegion`). */
  outline: Point2[];
  /**
   * Each slit on paper as an open polyline from the cut-out edge in along one side of the cut to the tip
   * and back out along the other side (the sides part where the paper opens up).
   */
  slits: Point2[][];
  /** How many slits a design line kept well short of their depth (see `PaperSlits.blocked`). */
  blockedSlits: number;
}

/**
 * Flatten the paper that covers the design. Meshes the surface under the cut-out region (the design
 * plus its margin, worked out in a layout close to the paper) in a locally metric chart, cuts the
 * slits into the mesh, flattens it with ARAP, and carries the design paths over through their
 * barycentric position in each triangle.
 *
 * Returns null when the design center misses the surface or no design point lands on it.
 */
export function flattenDesign({ surface, projection, center, paths, margin, slits: slitOptions }: FlattenOptions): FlatDesign | null {
  const centerHit = projection.project(center);
  if (!centerHit) return null;
  const chart = metricChart(surface, centerHit.coords);
  const overhang = MESH_OVERHANG * margin;
  const reach = margin + overhang;

  // Densify the design so straight front-view segments follow the surface, then work out the paper in a
  // layout close to the final one (the azimuthal layout about the center): the cut-out edge, the slits
  // and the meshed area are all measured in true distances there.
  const coarse = toDomain(paths, projection, chart).flat();
  if (coarse.length === 0) return null;
  const xs = [0, ...coarse.map((p) => p.x)], ys = [0, ...coarse.map((p) => p.y)];
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2 * reach;
  const domainPaths = toDomain(densify(paths, Math.min(extent / DESIGN_STEPS, margin / 4)), projection, chart);
  const toLayout = azimuthalLayout(surface, centerHit.coords);
  const layoutAt = (p: Point2) => toLayout(surface.sample(chart.toCoords(p)));
  const layoutPaths = domainPaths.map((path) => path.map(layoutAt)).filter((path) => path.length >= 2);
  if (layoutPaths.length === 0) return null;
  const region = cutRegion(withCenter(layoutPaths), margin, { reach: overhang });

  // Mesh cells sized for about MESH_CELLS of them over the paper, and at least a few across the margin.
  const paperArea = Math.abs(signedArea(region.outline)) + polylineLength([...region.outline, region.outline[0]]) * overhang;
  const spacing = Math.min(Math.sqrt(paperArea / MESH_CELLS), margin / 2);
  // The mesh is trimmed by true distances, which the chart only roughly follows: cover generously, and
  // sideways more where the chart overstates sideways distances.
  const limits = chart.limits();
  const minY = Math.max(limits.minY, Math.min(...ys) - 2 * reach);
  const maxY = Math.min(limits.maxY, Math.max(...ys) + 2 * reach);
  const reachX = 2 * reach * Math.max(chart.sidewaysOverstate(minY), chart.sidewaysOverstate(maxY));
  const grid = gridMesh(
    {
      minX: Math.max(limits.minX, Math.min(...xs) - reachX),
      maxX: Math.min(limits.maxX, Math.max(...xs) + reachX),
      minY,
      maxY,
      spacing,
    },
    (p) => surface.sample(chart.toCoords(p)).point,
  );
  const layoutOf = (mesh: TriangleMesh) => mesh.domain.map(layoutAt);
  const gridLayout = layoutOf(grid);
  const uncut = trimMesh(grid, (tri) => region.edgeDistance(centroid(tri.map((i) => gridLayout[i]))) <= overhang);

  const slitPlan = planSlits(uncut, layoutOf(uncut), region, slitOptions);
  const { mesh, otherSide } = cutSlits(uncut, slitPlan.chains);
  const raw = arapFlatten(mesh, { initial: layoutOf(mesh) });

  // Align: design center to the origin, the direction toward the stem (+v on the surface) to +y.
  const inDomain = meshLocator(mesh);
  const origin = carryPoint({ x: 0, y: 0 }, inDomain, mesh, raw);
  const up = carryPoint({ x: 0, y: spacing / 4 }, inDomain, mesh, raw);
  if (!origin || !up) return null;
  const angle = Math.PI / 2 - Math.atan2(up.y - origin.y, up.x - origin.x);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const flat = raw.map((p) => {
    const dx = p.x - origin.x, dy = p.y - origin.y;
    return { x: cos * dx - sin * dy, y: sin * dx + cos * dy };
  });

  const designPaths = carry(domainPaths, inDomain, mesh, flat);
  if (designPaths.length === 0) return null;
  // The cut-out edge again, now measured on the paper itself.
  const outline = cutRegion(withCenter(designPaths), margin, { bridging: region.bridging }).outline;
  const { slits, blocked } = finishSlits(
    slitPlan.chains.map((chain, s) => [...chain.map((v) => flat[v]), ...otherSide[s].slice(0, -1).reverse().map((v) => flat[v])]),
    slitPlan.chains.map((chain) => chain.length - 1),
    slitPlan,
    outline,
    designPaths,
    slitOptions,
  );
  const normals = mesh.domain.map((p) => surface.sample(chart.toCoords(p)).normal);
  return { paths: designPaths, outline, slits, blockedSlits: blocked, mesh, flat, normals };
}

/** The design paths plus the design center, which the paper must cover for the center cross. */
export function withCenter(paths: Point2[][]): Point2[][] {
  return [...paths, [{ x: 0, y: 0 }]];
}

/** Carry located paths over to a layout of the mesh through each point's triangle; misses are dropped. */
function carry(paths: Point2[][], locate: MeshLocator, mesh: TriangleMesh, layout: Point2[]): Point2[][] {
  return paths
    .map((path) =>
      path.flatMap((p) => {
        const at = locate(p);
        return at ? [barycentric(mesh.triangles[at.triangle].map((i) => layout[i]), at.weights)] : [];
      }),
    )
    .filter((path) => path.length >= 2);
}

function carryPoint(p: Point2, locate: MeshLocator, mesh: TriangleMesh, layout: Point2[]): Point2 | null {
  const at = locate(p);
  return at ? barycentric(mesh.triangles[at.triangle].map((i) => layout[i]), at.weights) : null;
}

/**
 * A chart of the surface around `center`: surface coordinates offset from the center and scaled
 * by the surface's local stretch factors, so domain lengths are close to true lengths nearby.
 */
function metricChart(surface: Surface, center: SurfaceCoords) {
  const h = 1e-5;
  const at = (du: number, dv: number) => surface.sample({ u: center.u + du, v: center.v + dv }).point;
  const p = at(0, 0);
  const su = length3(sub3(at(h, 0), p)) / h;
  const sv = length3(sub3(at(0, h), p)) / h;
  return {
    toDomain: ({ u, v }: SurfaceCoords): Point2 => ({ x: (u - center.u) * su, y: (v - center.v) * sv }),
    toCoords: ({ x, y }: Point2): SurfaceCoords => ({ u: center.u + x / su, v: center.v + y / sv }),
    /** How much the chart overstates true sideways distances at domain height `y` (1 at the center row). */
    sidewaysOverstate: (y: number): number => {
      const v = center.v + y / sv;
      const q = surface.sample({ u: center.u, v }).point;
      return su / Math.max(1e-9, length3(sub3(surface.sample({ u: center.u + h, v }).point, q)) / h);
    },
    /** Domain range that stays clear of the edges of the surface coordinates (poles, seam). */
    limits: () => {
      const { minU, maxU, minV, maxV } = surface.coordRange;
      const gapU = EDGE_GAP * (maxU - minU), gapV = EDGE_GAP * (maxV - minV);
      return {
        minX: (minU + gapU - center.u) * su,
        maxX: (maxU - gapU - center.u) * su,
        minY: (minV + gapV - center.v) * sv,
        maxY: (maxV - gapV - center.v) * sv,
      };
    },
  };
}

/**
 * A fold-free layout close to the ARAP result: each surface point goes in its direction from the
 * center (in the tangent plane there, +u right, +v up) at roughly its distance along the surface.
 * The distance is the chord corrected by the turn of the normal, which is exact on a sphere.
 */
function azimuthalLayout(surface: Surface, center: SurfaceCoords): (sample: SurfaceSample) => Point2 {
  const h = 1e-5;
  const c = surface.sample(center);
  const n = c.normal;
  const tangent = (d: readonly [number, number, number]) => normalize3(sub3(d, scale3(n, dot3(d, n))));
  const right = tangent(sub3(surface.sample({ u: center.u + h, v: center.v }).point, c.point));
  const along = tangent(sub3(surface.sample({ u: center.u, v: center.v + h }).point, c.point));
  const up = tangent(sub3(along, scale3(right, dot3(along, right))));

  return ({ point, normal }) => {
    const d = sub3(point, c.point);
    const chord = Math.hypot(...d);
    if (chord === 0) return { x: 0, y: 0 };
    const half = Math.acos(Math.max(-1, Math.min(1, dot3(normal, n)))) / 2;
    const along = half > 1e-9 ? (chord * half) / Math.sin(half) : chord;
    const x = dot3(d, right), y = dot3(d, up);
    const len = Math.hypot(x, y) || 1;
    return { x: (along * x) / len, y: (along * y) / len };
  };
}

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
      const pieces = Math.max(1, Math.ceil(distance(a, b) / step));
      return Array.from({ length: pieces }, (_, k) => ({
        x: a.x + ((b.x - a.x) * k) / pieces,
        y: a.y + ((b.y - a.y) * k) / pieces,
      }));
    }),
  );
}
