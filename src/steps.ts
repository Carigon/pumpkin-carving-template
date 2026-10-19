/**
 * The step model: which steps the controls pane offers and what the viewport shows on each. Pure, so the
 * DOM wiring (tabs, Back/Next, the viewport) only renders what this returns.
 */

/** What the app is making: a pumpkin template, or a test grid to check the template on a ball. */
export type Mode = "pumpkin" | "test-grid";

/** In test-grid mode the Design step is the Grid step. */
export type StepId = "measure" | "design" | "grid" | "template";

/** What the viewport can show. */
export type View = "3d" | "trace";

export interface Step {
  id: StepId;
  title: string;
  /** The view the viewport switches to on entering the step. */
  defaultView: View;
  /** The views the carver can pick on this step; always includes `defaultView`. */
  views: readonly View[];
}

/** What the step list depends on. */
export interface StepState {
  mode: Mode;
  /** An image design is loaded and still being traced. */
  tracing: boolean;
  /** An image design is loaded, traced or with its trace accepted (implied by `tracing`). Absent means none. */
  image?: boolean;
}

export const STEP_IDS: readonly StepId[] = ["measure", "design", "grid", "template"];

/** The same step in `mode`: Design and Grid stand in for each other, the rest are in both modes. */
export function stepInMode(step: StepId, mode: Mode): StepId {
  if (step === "design" && mode === "test-grid") return "grid";
  if (step === "grid" && mode === "pumpkin") return "design";
  return step;
}

/** The steps, in order. */
export function steps(state: StepState): Step[] {
  const step = (id: StepId, title: string): Step => ({ id, title, defaultView: "3d", views: ["3d"] });
  return [
    step("measure", "Measure"),
    state.mode === "test-grid" ? step("grid", "Grid") : designStep(state),
    step("template", "Template"),
  ];
}

/** Design shows the image being traced until the trace is accepted, then the design on the pumpkin. */
function designStep(state: StepState): Step {
  const image = state.tracing || state.image === true;
  return {
    id: "design",
    title: "Design",
    defaultView: state.tracing ? "trace" : "3d",
    // Trace only while there's an image to show, so the switcher never lands on an empty view.
    views: image ? ["3d", "trace"] : ["3d"],
  };
}
