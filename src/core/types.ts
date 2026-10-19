import type { Vec3 } from "./surface/surface";

/** Length units the user measures in. All physical lengths in builder input/output use these units. */
export type Units = "in" | "cm";

/** Tape-measure measurements of the pumpkin. */
export interface PumpkinMeasurements {
  /** Widest horizontal circumference. */
  circumference: number;
  /** Stem-to-base arc measured over the front. */
  frontArc: number;
  /** Optional front-to-back depth (full diameter, not radius). */
  depth?: number;
  units: Units;
}

/** Semi-axes of the fitted ellipsoid, in the measurement units. */
export interface SemiAxes {
  /** Side-to-side (x). */
  sideToSide: number;
  /** Front-to-back (z, the viewing axis). */
  frontToBack: number;
  /** Stem-to-base half-height (y). */
  vertical: number;
}

/** Derived surface parameters, for the preview and the PDF info block. */
export interface SurfaceParameters {
  kind: "ellipsoid";
  semiAxes: SemiAxes;
  units: Units;
}

/** Which input a measurement warning refers to, so the UI can show it next to that field. */
export type MeasurementField = "circumference" | "frontArc" | "depth";

export interface MeasurementWarning {
  kind: "impossible-measurement";
  field: MeasurementField;
  message: string;
}

/** Parts of the design land where the surface faces more than about 60° away from the viewer. Not a block. */
export interface FrontLimitWarning {
  kind: "past-front-limit";
  /** Largest angle from the front reached by any design point, in degrees. */
  maxAngle: number;
  message: string;
}

/** Some design points fall outside the pumpkin's outline as seen from the front, so they have nowhere to land. */
export interface OutsideSilhouetteWarning {
  kind: "outside-silhouette";
  /** Number of design points that miss the pumpkin. */
  count: number;
  message: string;
}

export type TemplateWarning = MeasurementWarning | FrontLimitWarning | OutsideSilhouetteWarning;

/** A 2D point. Design points are in design units, y up (toward the stem). */
export interface Point2 {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The carving design as the input layer hands it over: closed polylines (implicitly closed) in design units, y up. */
export interface Design {
  paths: Point2[][];
  bbox: BBox;
}

/** Where the design sits on the pumpkin, as seen from the front. */
export interface Placement {
  /** Width of the design's bounding box as seen from the front, in the measurement units. */
  width: number;
  /** How far the design's center sits above the pumpkin's center (negative = below), in the measurement units. */
  verticalOffset: number;
  /** Rotation in degrees, counterclockwise as seen from the front. */
  rotation: number;
}

export interface TemplateInput {
  measurements: PumpkinMeasurements;
  /** The design to place. Projection happens only when both design and placement are given. */
  design?: Design;
  placement?: Placement;
}

/** One design point after projection. */
export interface ProjectedPoint {
  /** Placed position in the front view (x right, y up), in the measurement units. */
  front: Point2;
  /** Where the point lands on the pumpkin, or null if it misses the silhouette. */
  surface: { point: Vec3; normal: Vec3 } | null;
  /** Angle in degrees between the surface's facing direction and the viewing axis; null if it missed. */
  angleFromFront: number | null;
}

export interface ProjectedPath {
  points: ProjectedPoint[];
}

/** The design projected onto the 3D surface, for the preview. Same path and point order as the input design. */
export interface ProjectedDesign {
  paths: ProjectedPath[];
}

export interface TemplateResult {
  /** Fitted surface, or null when the measurements are impossible. */
  surface: SurfaceParameters | null;
  /** The projected design, or null when there is no design/placement or no surface. */
  design: ProjectedDesign | null;
  warnings: TemplateWarning[];
}
