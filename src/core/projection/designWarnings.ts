import type { ProjectedDesign, TemplateWarning } from "../types";

/** Beyond this angle from the front, the design is badly foreshortened on the skin. */
const FRONT_LIMIT_DEGREES = 60;

/** Warnings about where the projected design lands. */
export function designWarnings(design: ProjectedDesign): TemplateWarning[] {
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
