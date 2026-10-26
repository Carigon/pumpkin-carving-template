import type { BBox, Design, Placement, Point2 } from "../types";

/**
 * Place the design in the front view: center its bounding box on the pumpkin's front axis,
 * scale it to the requested width, rotate it about its center, then shift it up by the vertical offset.
 */
export function placeDesign({ paths, bbox }: Design, { width, verticalOffset, rotation }: Placement): Point2[][] {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const scale = placedScale(bbox, width);
  const t = (rotation * Math.PI) / 180;
  const cos = Math.cos(t) * scale;
  const sin = Math.sin(t) * scale;
  return paths.map((path) =>
    path.map(({ x, y }) => {
      const dx = x - cx;
      const dy = y - cy;
      return { x: cos * dx - sin * dy, y: sin * dx + cos * dy + verticalOffset };
    }),
  );
}

/** Front-view mm per design unit, for a design whose box is `bbox` placed `width` wide. */
export function placedScale(bbox: BBox, width: number): number {
  const bboxWidth = bbox.maxX - bbox.minX;
  return bboxWidth > 0 ? width / bboxWidth : 0;
}
