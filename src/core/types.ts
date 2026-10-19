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

export type TemplateWarning = MeasurementWarning;

export interface TemplateInput {
  measurements: PumpkinMeasurements;
}

export interface TemplateResult {
  /** Fitted surface, or null when the measurements are impossible. */
  surface: SurfaceParameters | null;
  warnings: TemplateWarning[];
}
