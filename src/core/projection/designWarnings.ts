import { arrange } from "../geometry/regions";
import type { BBox, Design, Placement, ProjectedDesign, TemplateWarning } from "../types";
import { placeDesign, placedScale } from "./placement";
import type { Projection } from "./projection";

/** Beyond this angle from the front, the design is badly foreshortened on the skin. */
const FRONT_LIMIT_DEGREES = 60;
/** A carve area smaller than this across, on the skin, is hard to cut. */
const MIN_CARVE_SIZE_MM = 5;

/** The design as placed and projected, for its warnings. */
export interface PlacedDesign {
  design: Design;
  placement: Placement;
  projection: Projection;
  projected: ProjectedDesign;
}

/** Warnings about the design: where the projected design lands, and shapes that won't carve well. */
export function designWarnings(placed: PlacedDesign): TemplateWarning[] {
  return [...placementWarnings(placed.projected), ...shapeWarnings(placed)];
}

/** Warnings about where the projected design lands. */
function placementWarnings(design: ProjectedDesign): TemplateWarning[] {
  const warnings: TemplateWarning[] = [];
  let maxAngle = 0;
  let missed = 0;
  for (const path of design.paths) {
    for (const p of path.points) {
      if (p.angleFromFront === null) missed++;
      else maxAngle = Math.max(maxAngle, p.angleFromFront);
    }
  }
  if (missed > 0) {
    warnings.push({
      kind: "outside-silhouette",
      count: missed,
      message:
        `${missed} design point${missed === 1 ? "" : "s"} fall outside the pumpkin as seen from the front ` +
        `and can't be placed. Make the design smaller or move it toward the center.`,
    });
  }
  if (maxAngle > FRONT_LIMIT_DEGREES) {
    warnings.push({
      kind: "past-front-limit",
      maxAngle,
      message:
        `Parts of the design reach ${Math.round(maxAngle)}° from the front (past about ${FRONT_LIMIT_DEGREES}°). ` +
        `They will look squashed from the front and be hard to transfer. Consider a smaller width.`,
    });
  }
  return warnings;
}

/** Warnings about shapes that won't carve well: crossings, floating pieces and tiny carve areas. */
function shapeWarnings({ design, placement, projection }: PlacedDesign): TemplateWarning[] {
  const { crossings, regions } = arrange(design.paths);
  const warnings: TemplateWarning[] = [];
  if (crossings.length > 0) warnings.push({ kind: "crossing", at: crossings });
  const pieces = regions.filter((r) => !r.carved).map(({ outline, bbox }) => ({ outline, bbox }));
  if (pieces.length > 0) warnings.push({ kind: "floating-piece", pieces });
  const areas = regions
    .filter((r) => r.carved && sizeOnSkin(r.bbox, design, placement, projection) < MIN_CARVE_SIZE_MM)
    .map(({ outline, bbox }) => ({ outline, bbox }));
  if (areas.length > 0) warnings.push({ kind: "tiny-carve-area", areas, minSizeMm: MIN_CARVE_SIZE_MM });
  return warnings;
}

/**
 * The longest side on the skin, in mm, of a carve area's box in the design's own axes (so the placement's rotation
 * doesn't change it): each side, at carved size, is stretched by how far the skin at the box's middle turns away along
 * it. Only boxes under the least size at carved size are measured, since the skin is never smaller than its front
 * view; one whose middle misses the pumpkin keeps its carved size.
 */
function sizeOnSkin(box: BBox, design: Design, placement: Placement, projection: Projection): number {
  const scale = placedScale(design.bbox, placement.width);
  const width = (box.maxX - box.minX) * scale, height = (box.maxY - box.minY) * scale;
  if (Math.max(width, height) >= MIN_CARVE_SIZE_MM) return Math.max(width, height);
  const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const [[front]] = placeDesign({ paths: [[middle]], bbox: design.bbox }, placement);
  const hit = projection.project(front);
  if (!hit) return Math.max(width, height);
  const t = (placement.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(t), Math.sin(t)];
  return Math.max(width * stretch(hit.normal, cos, sin), height * stretch(hit.normal, -sin, cos));
}

/** How much longer a front-view step along (dx, dy), a unit vector, is on skin facing `normal`. */
function stretch([nx, ny, nz]: readonly [number, number, number], dx: number, dy: number): number {
  return Math.hypot(1, (nx * dx + ny * dy) / Math.max(Math.abs(nz), 1e-9));
}
