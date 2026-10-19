import type { Vec3 } from "./surface/surface";

/** Length units the user measures in. All physical lengths in builder input/output use these units. */
export type Units = "in" | "cm";

/** Tape-measure measurements of the pumpkin. */
export interface PumpkinMeasurements {
  /**
   * Straight vertical height from the table to the underside of a book laid flat on the pumpkin's shoulders.
   * The stem and its dimple are left out: the model's top is a smooth pole.
   */
  height: number;
  /**
   * Horizontal tape rings, at least one. The one with the largest circumference is the widest part of the
   * pumpkin. Every horizontal cross-section is a circle.
   */
  rings: Ring[];
  units: Units;
}

/** A horizontal tape ring around the pumpkin. */
export interface Ring {
  circumference: number;
  /** Where the ring was taken, as a fraction of the height: 0 = bottom (the table), 1 = top. */
  position: number;
}

/** Half the fitted shape's size along each axis, in the measurement units. */
export interface SemiAxes {
  /** Side-to-side (x). */
  sideToSide: number;
  /** Front-to-back (z, the viewing axis). */
  frontToBack: number;
  /** Stem-to-base half-height (y). */
  vertical: number;
}

/** One point of the side profile: the side-to-side radius at a height (y, stem up, 0 at mid-height). */
export interface ProfilePoint {
  radius: number;
  height: number;
}

/** Derived surface parameters, for the preview and the PDF info block. */
export interface SurfaceParameters {
  /** "ellipsoid" when the smoothest shape through the rings is one (e.g. a single ring at mid-height), else "revolved". */
  kind: "ellipsoid" | "revolved";
  /**
   * Half the overall size: largest side-to-side and front-to-back radius and half the height.
   * For the ellipsoid these are its semi-axes.
   */
  semiAxes: SemiAxes;
  /** Side profile from stem to base (finely sampled); the surface is this profile spun around the y axis. */
  profile: ProfilePoint[];
  units: Units;
}

/** Which input a measurement warning refers to, so the UI can show it next to that field. */
export type MeasurementField = "height" | "ring";

export interface MeasurementWarning {
  kind: "impossible-measurement";
  field: MeasurementField;
  /** For field "ring": the index of the offending ring in `PumpkinMeasurements.rings` (none: the rings as a whole). */
  ring?: number;
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

/**
 * Some slits ran into design lines well before their set depth (under half of it), so they were cut short (or
 * left out). Slits that only fall a little short, or are limited by the size of the paper, don't count.
 */
export interface SlitShortenedWarning {
  kind: "slit-shortened";
  /** Number of slits cut short. */
  count: number;
  message: string;
}

export type TemplateWarning = MeasurementWarning | FrontLimitWarning | OutsideSilhouetteWarning | SlitShortenedWarning;

/** Slits let the paper bend around the pumpkin. They're spaced evenly in angle around the design center. */
export interface SlitOptions {
  /** Number of slits (0 = none). */
  count: number;
  /** How far each slit runs in from the cut-out edge, in the measurement units. */
  depth: number;
}

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
  /** Slit count and depth; defaults to `defaultSlits(units)`. */
  slits?: SlitOptions;
  /** Paper margin between the design and the cut-out edge, in the measurement units; defaults to `defaultMargin(units)`. */
  margin?: number;
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
  /** The flat paper template, or null when there is no projected design or none of it lands on the pumpkin. */
  template: FlatTemplate | null;
  warnings: TemplateWarning[];
}

/**
 * The flat paper template, in physical paper units (the measurement units).
 * Origin at the design center (where the center cross goes); +y points toward the stem.
 */
export interface FlatTemplate {
  units: Units;
  /** Flattened design paths (carve areas), implicitly closed. Holes are nested paths: fill them even-odd. */
  designPaths: Point2[][];
  /**
   * The cut-out edge: the design's outline grown by the margin (3/4 in unless set), following it into concave parts. One piece:
   * holes are filled and separate parts of the design are bridged. Implicitly closed, counterclockwise.
   */
  cutOutline: Point2[];
  /**
   * Slits to cut, as open polylines starting and ending on the cut-out edge: in along one side of the
   * slit to its tip and back out along the other. The sides part slightly where the paper opens up.
   */
  slits: Point2[][];
  /** How much the paper is stretched, per triangle of the flattened patch. */
  stretch: StretchMap;
}

/**
 * Stretch per area of the flattened patch, on both the 3D surface and the paper. The two share
 * triangle indices: `triangles[t]` indexes into `surface` (3D, same axes as the preview) and into
 * `flat` (paper, same frame as the template), and `values[t]` is that triangle's stretch.
 */
export interface StretchMap {
  triangles: [number, number, number][];
  surface: Vec3[];
  /** Outward unit surface normal at each `surface` vertex. */
  normals: Vec3[];
  flat: Point2[];
  /**
   * Per triangle: max(σ1, 1/σ2) − 1, with σ the singular values of the surface → paper map.
   * 0 = the paper matches the surface exactly; 0.05 = some direction is off by 5 %.
   */
  values: number[];
  /** Largest per-triangle value. */
  max: number;
  /** Area-weighted root mean square over the patch. */
  rms: number;
}
