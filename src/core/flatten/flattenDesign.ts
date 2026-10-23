import { DESIGN_STEPS, densify } from "../geometry/densify";
import { signedArea } from "../geometry/distanceField";
import { barycentric, centroid, cross3, distance, dot3, normalize3, polylineLength, scale3, sub3 } from "../geometry/vector";
import type { MeshHit, MeshLocation, MeshSurface } from "../mesh/meshSurface";
import type { Projection } from "../projection/projection";
import type { SurfaceSample, Vec3 } from "../surface/surface";
import { cutRegion } from "../template/cutOutline";
import { finishSlits } from "../template/slits";
import type { Point2 } from "../types";
import { trimMesh, type TriangleMesh } from "./mesh";
import { growPatch, longestEdge, refinePatch, weldMesh } from "./patch";
import { placeSlits, type SlitPlacementOptions } from "./placeSlits";

/** Squares' worth of fine triangles over the paper (two triangles each): a few thousand triangles. */
const MESH_CELLS = 1500;
/** The mesh reaches this many margins past the cut-out edge, so the edge and the slit ends sit inside it. */
const MESH_OVERHANG = 0.5;

export interface FlattenOptions {
  /** The surface mesh the projection's hits lie on. */
  surface: MeshSurface;
  projection: Projection;
  /** The design center in the front view. */
  center: Point2;
  /** Placed front-view design paths (closed). */
  paths: Point2[][];
  /** Paper margin between the design and the cut-out edge. */
  margin: number;
  slits: SlitPlacementOptions;
}

export interface FlatDesign {
  /** Design paths on paper: origin at the design center, +y toward the stem, physical units. */
  paths: Point2[][];
  /** The flattened mesh, for stretch. `flat[i]` is the paper position of `mesh.vertices[i]`. */
  mesh: TriangleMesh;
  flat: Point2[];
  /** The cut-out edge on paper: the design's outline grown by the margin (see `cutRegion`). */
  outline: Point2[];
  /**
   * Each slit on paper as an open polyline from the cut-out edge in along one side of the cut to the tip
   * and back out along the other side (the sides part where the paper opens up).
   */
  slits: Point2[][];
  /** Auto placed as many slits as it may and the paper still stretches more than its target. */
  overTarget: boolean;
}

/**
 * Flatten the paper that covers the design. Cuts the patch under the cut-out region (the design plus its margin
 * and overhang, worked out in a layout close to the paper) out of the surface mesh, refines it so it follows the
 * design and the cut-out edge closely enough, cuts the slits into it, flattens it with ARAP, and carries the
 * design paths over through their barycentric position in each triangle.
 *
 * Placing the slits takes a while: the steps yield the number placed so far after each, so a caller can report
 * progress or stop between slits. Returns null when the design center misses the surface or no design point lands
 * on it.
 */
export function* flattenDesign({ surface, projection, center, paths, margin, slits: slitOptions }: FlattenOptions): Generator<number, FlatDesign | null> {
  const centerHit = projection.project(center);
  if (!centerHit) return null;
  const overhang = MESH_OVERHANG * margin;
  const reach = margin + overhang;
  const toLayout = azimuthalLayout(centerHit);

  // Densify the design so straight front-view segments follow the surface, then work out the paper in a
  // layout close to the final one (the azimuthal layout about the center): the cut-out edge, the slits
  // and the patch are all measured in true distances there.
  const coarse = projectPaths(paths, projection).flat().map(toLayout);
  if (coarse.length === 0) return null;
  const xs = [0, ...coarse.map((p) => p.x)], ys = [0, ...coarse.map((p) => p.y)];
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2 * reach;
  const designHits = projectPaths(densify(paths, Math.min(extent / DESIGN_STEPS, margin / 4)), projection);
  const layoutPaths = designHits.map((path) => path.map(toLayout)).filter((path) => path.length >= 2);
  if (layoutPaths.length === 0) return null;
  const region = cutRegion(withCenter(layoutPaths), margin, { reach: overhang });

  // Fine triangles sized for about MESH_CELLS cells over the paper, and at least a few across the margin.
  const paperArea = Math.abs(signedArea(region.outline)) + polylineLength([...region.outline, region.outline[0]]) * overhang;
  const spacing = Math.min(Math.sqrt(paperArea / MESH_CELLS), margin / 2);

  // The patch: the surface triangles under the paper, grown out from the design center. A triangle counts if any
  // part of it may lie within the overhang, so its refined triangles can then be trimmed to the overhang exactly.
  const sheet = weldMesh(surface.mesh);
  const layoutOf = (mesh: TriangleMesh) => mesh.vertices.map((point, v) => toLayout({ point, normal: mesh.normals[v] }));
  const sheetLayout = layoutOf(sheet);
  const box = boundingBox(region.outline);
  const patch = growPatch(sheet, centerHit.triangle, (t) => {
    const corners = sheet.triangles[t].map((v) => sheetLayout[v]);
    const middle = centroid(corners);
    const slack = overhang + Math.max(...corners.map((p) => distance(p, middle)));
    // `edgeDistance` only reaches a little past the overhang: further out, the distance to the outline's box bounds it.
    const outside = Math.hypot(Math.max(box.minX - middle.x, 0, middle.x - box.maxX), Math.max(box.minY - middle.y, 0, middle.y - box.maxY));
    return outside <= slack && region.edgeDistance(middle) <= slack;
  });
  // Split so the fine triangles' legs are no longer than the spacing (their diagonals √2 times it), as on a square grid.
  const refined = refinePatch(sheet, patch, Math.max(1, Math.ceil(longestEdge(sheet, patch) / (Math.SQRT2 * spacing))));
  const fineLayout = layoutOf(refined.mesh);
  const { mesh: uncut, newIndex } = trimMesh(refined.mesh, (tri) => region.edgeDistance(centroid(tri.map((v) => fineLayout[v]))) <= overhang);
  if (uncut.triangles.length === 0) return null;
  /** A hit on the surface mesh, located in the trimmed patch (and the cut one: cutting keeps triangle indices). */
  const locate = (hit: MeshLocation): MeshLocation | null => {
    const fine = refined.locate(hit);
    if (!fine || newIndex[fine.triangle] < 0) return null;
    return { triangle: newIndex[fine.triangle], weights: fine.weights };
  };

  const { chains, mesh, otherSide, flat: raw, overTarget } = yield* placeSlits(uncut, layoutOf(uncut), region, slitOptions);
  const initial = layoutOf(mesh);

  // Align: design center to the origin, and the direction toward the stem there (+y in the layout, carried onto the
  // paper through the triangle under the center) to +y.
  const at = locate(centerHit);
  if (!at) return null;
  const origin = carryPoint(at, mesh, raw);
  const corners = mesh.triangles[at.triangle];
  const up = carryDirection(corners.map((v) => initial[v]), corners.map((v) => raw[v]), { x: 0, y: 1 });
  const angle = Math.PI / 2 - Math.atan2(up.y, up.x);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const flat = raw.map((p) => {
    const dx = p.x - origin.x, dy = p.y - origin.y;
    return { x: cos * dx - sin * dy, y: sin * dx + cos * dy };
  });

  const designPaths = designHits
    .map((path) =>
      path.flatMap((hit) => {
        const fine = locate(hit);
        return fine ? [carryPoint(fine, mesh, flat)] : [];
      }),
    )
    .filter((path) => path.length >= 2);
  if (designPaths.length === 0) return null;
  // The cut-out edge again, now measured on the paper itself.
  const outline = cutRegion(withCenter(designPaths), margin, { bridging: region.bridging }).outline;
  const slits = finishSlits(
    chains.map((chain, s) => [...chain.map((v) => flat[v]), ...otherSide[s].slice(0, -1).reverse().map((v) => flat[v])]),
    chains.map((chain) => chain.length - 1),
    outline,
    designPaths,
    slitOptions,
  );
  return { paths: designPaths, outline, slits, overTarget, mesh, flat };
}

/** The design paths plus the design center, which the paper must cover for the center cross. */
function withCenter(paths: Point2[][]): Point2[][] {
  return [...paths, [{ x: 0, y: 0 }]];
}

function carryPoint({ triangle, weights }: MeshLocation, mesh: TriangleMesh, layout: Point2[]): Point2 {
  return barycentric(mesh.triangles[triangle].map((i) => layout[i]), weights);
}

function boundingBox(points: Point2[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Where the affine map taking triangle `from` onto triangle `to` sends the direction `d`. */
function carryDirection([a, b, c]: Point2[], [p, q, r]: Point2[], d: Point2): Point2 {
  // Weights of d along the edges a→b and a→c, then the same weights along p→q and p→r.
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y;
  const det = ux * vy - uy * vx;
  const s = (d.x * vy - d.y * vx) / det, t = (ux * d.y - uy * d.x) / det;
  return { x: s * (q.x - p.x) + t * (r.x - p.x), y: s * (q.y - p.y) + t * (r.y - p.y) };
}

/**
 * A fold-free layout close to the ARAP result: each surface point goes in its direction from the center (in the
 * tangent plane there, +y toward the stem) at roughly its distance along the surface. The distance is the chord
 * corrected by the turn of the normal, which is exact on a sphere.
 */
function azimuthalLayout(c: SurfaceSample): (sample: SurfaceSample) => Point2 {
  const n = c.normal;
  const tangent = (d: Vec3) => sub3(d, scale3(n, dot3(d, n)));
  // Up is the stem direction laid into the tangent plane; where the surface faces the stem, away from the viewer.
  const toStem = tangent([0, 1, 0]);
  const up = normalize3(Math.hypot(...toStem) > 1e-6 ? toStem : tangent([0, 0, -1]));
  const right = cross3(up, n);

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

/** Project front-view paths onto the mesh; points that miss it are dropped. */
function projectPaths(paths: Point2[][], projection: Projection): MeshHit[][] {
  return paths.map((path) =>
    path.flatMap((p) => {
      const hit = projection.project(p);
      return hit ? [hit] : [];
    }),
  );
}
