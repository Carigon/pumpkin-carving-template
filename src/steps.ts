/**
 * The step model: which steps the controls pane offers, what the viewport shows on each and which carry a
 * warning badge. Pure, so the DOM wiring (tabs, Back/Next, the viewport) only renders what this returns.
 */
import type { TemplateWarning } from "./core";

/** What the app is making: a pumpkin template, or a test grid to check the template on a ball. */
export type Mode = "pumpkin" | "test-grid";

/** In test-grid mode the Design step is the Grid step. */
export type StepId = "measure" | "design" | "grid" | "template";

/** What the viewport can show. */
export type View = "3d" | "blueprint" | "trace" | "paper";

export interface Step {
  id: StepId;
  title: string;
  /** The view the viewport switches to on entering the step. */
  defaultView: View;
  /** The views the carver can pick on this step; always includes `defaultView`. */
  views: readonly View[];
  /** The step's tab carries a warning badge: at least one of the current warnings belongs to this step. */
  warned: boolean;
}

/** What the step list depends on. */
export interface StepState {
  mode: Mode;
  /** An image design is loaded and still being traced. */
  tracing: boolean;
  /** An image design is loaded, being traced or with its trace accepted (implied by `tracing`). */
  hasImage: boolean;
  /** The warnings showing now, for the badges. */
  warnings: readonly Pick<TemplateWarning, "kind">[];
}

export const STEP_IDS: readonly StepId[] = ["measure", "design", "grid", "template"];

/** The same step in `mode`: Design and Grid stand in for each other, the rest are in both modes. */
export function stepInMode(step: StepId, mode: Mode): StepId {
  if (step === "design" && mode === "test-grid") return "grid";
  if (step === "grid" && mode === "pumpkin") return "design";
  return step;
}

/** The steps, in order, each saying whether its tab carries a warning badge. */
export function steps(state: StepState): Step[] {
  const warned = new Set(state.warnings.map((w) => stepInMode(WARNING_STEP[w.kind], state.mode)));
  const step = (id: StepId, title: string): StepViews => ({ id, title, defaultView: "3d", views: ["3d"] });
  const list: StepViews[] = [
    // The shape is checked against a ruler while measuring; 3D shows it in the round.
    { id: "measure", title: "Measure", defaultView: "blueprint", views: ["3d", "blueprint"] },
    state.mode === "test-grid" ? step("grid", "Grid") : designStep(state),
    // The template is judged flat on the paper; 3D still shows the stretch tint on the pumpkin.
    { id: "template", title: "Template", defaultView: "paper", views: ["3d", "paper"] },
  ];
  return list.map((s) => ({ ...s, warned: warned.has(s.id) }));
}

/** A step before its badge is known. */
type StepViews = Omit<Step, "warned">;

/** Design shows the image being traced until the trace is accepted, then the design on the pumpkin. */
function designStep(state: StepState): StepViews {
  return {
    id: "design",
    title: "Design",
    defaultView: state.tracing ? "trace" : "3d",
    // Trace only while there's an image to show, so the switcher never lands on an empty view.
    views: state.tracing || state.hasImage ? ["3d", "trace"] : ["3d"],
  };
}

/** Which step each kind of warning belongs to (Design stands for Grid in test-grid mode). */
const WARNING_STEP: Record<TemplateWarning["kind"], StepId> = {
  "impossible-measurement": "measure",
  "past-front-limit": "design",
  "outside-silhouette": "design",
  "slits-dont-fit": "template",
  "slit-limit": "template",
};
