import "./ui/style.css";
import { createTemplateBuilder, type SurfaceParameters, type TemplateWarning } from "./core";
import { ballMeasurements, gridDesign } from "./input/calibrationGrid";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountBlueprintView } from "./ui/blueprintViewSvg";
import { mountDesignPanel } from "./ui/designPanel";
import { mountExportPanel, type ExportSource } from "./ui/exportPanel";
import { mountGridPanel } from "./ui/gridPanel";
import { mountHeader } from "./ui/header";
import { mountMeasurementForm } from "./ui/measurementForm";
import { mountPaperView } from "./ui/paperViewSvg";
import { mountSlitPanel } from "./ui/slitPanel";
import { mountStepTabs } from "./ui/stepTabs";
import { renderSurfaceInfo } from "./ui/surfaceInfo";
import { mountViewport } from "./ui/viewport";
import { createMeasureStore, startingMeasurements, type MeasureChange, type MeasureState } from "./measureState";
import { paperView } from "./paperView";
import { browserStorage, loadSettings, saveSettings } from "./settings";
import { stepInMode, steps, type Step, type StepId } from "./steps";
import { startBackgroundBuild, type BuildOutcome } from "./worker/backgroundBuild";

const app = document.querySelector<HTMLElement>("#app")!;
// Below the breakpoint the pieces stack in this order: header, viewport, step tabs, step content.
app.innerHTML = `
  <header id="header"></header>
  <section id="viewport"></section>
  <div class="controls">
    <div id="step-tabs"></div>
    <section id="step-measure" class="step-panel">
      <div id="measurements"></div>
      <div id="surface-info" class="card" aria-live="polite"></div>
    </section>
    <section id="step-design" class="step-panel">
      <div id="grid" class="ball-only"></div>
      <div id="design"></div>
    </section>
    <section id="step-template" class="step-panel">
      <div id="slits"></div>
      <div id="export"></div>
    </section>
  </div>
`;

const $ = (id: string) => app.querySelector<HTMLElement>(`#${id}`)!;
const infoEl = $("surface-info");
const header = mountHeader($("header"), changeMode, changeUnits);
const viewport = mountViewport($("viewport"));
const preview = mountPumpkinPreview(viewport.canvas);
const paper = mountPaperView(viewport.paperView);
// The measurements the form and the Blueprint view both render from and edit.
const measures = createMeasureStore({ measurements: { height: Number.NaN, rings: [] }, lastEdited: null });
const form = mountMeasurementForm($("measurements"), (measurements, edited) =>
  measures.set({ measurements, ...(edited === null ? {} : { lastEdited: edited }) }, { source: "form", live: false }),
);
const blueprint = mountBlueprintView(viewport.blueprintView, (measurements, edited, live) =>
  measures.set({ measurements, ...(edited === null ? {} : { lastEdited: edited }) }, { source: "view", live }),
);
const gridPanel = mountGridPanel($("grid"), update);
const designPanel = mountDesignPanel($("design"), update, viewport.traceView);
const slitPanel = mountSlitPanel($("slits"), update);
const exportPanel = mountExportPanel($("export"), header.units, changePaper);
// Design and Grid share one panel: in test-grid mode the grid size shows and the pumpkin-only design inputs
// (file, tracing, width) hide; move up/down and rotation apply to the grid too.
const designStep = $("step-design");
const tabs = mountStepTabs(
  $("step-tabs"),
  { measure: $("step-measure"), design: designStep, grid: designStep, template: $("step-template") },
  goTo,
);
/** The step showing in the controls pane. */
let step: StepId = "measure";
/** Whether an image is being traced and whether one is loaded, as last seen by `followTrace` (none at start). */
let lastTracing = false;
let lastHasImage = false;
/** The warnings showing now, for the step tabs' badges. */
let warnings: TemplateWarning[] = [];
/** The fitted surface showing now (null: the measurements are impossible), for its size in the display units. */
let surface: SurfaceParameters | null = null;
// The quick preview (projection alone) runs here on every edit; flattening runs in the worker.
const builder = createTemplateBuilder();
const background = startBackgroundBuild(showTemplate, ({ slits }) => viewport.setStatus(`Placing slits… ${slits}`));
/** The export details of the latest edit, to pair with the worker's template when it arrives. */
let pending: Omit<ExportSource, "template"> | null = null;
/** The latest template the worker built, with its export details, for the Paper view (null: none). */
let built: ExportSource | null = null;
restore();
showUnits();
syncMode();
enterStep();
update();
measures.subscribe(followMeasures);

/** Put back the last-used settings (lengths in mm; the display units go to the header). */
function restore(): void {
  const saved = loadSettings(browserStorage());
  header.restore(saved);
  const measurements = startingMeasurements(saved.measurements);
  // Nothing edited yet: a shape that doesn't fit on load isn't blamed on a ring.
  measures.set({ measurements, lastEdited: null }, { source: "form", live: false });
  form.show(measurements);
  gridPanel.restore(saved);
  designPanel.restorePlacement(saved.placement ?? {});
  slitPanel.restore(saved.slits ?? {}, saved.cut);
  exportPanel.restore(saved);
  if (saved.step) step = saved.step;
}

/** Remember the current settings (never the design). */
function persist(): void {
  const m = measures.get().measurements;
  const p = designPanel.placement();
  const orNull = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : null);
  const slits = slitPanel.options();
  saveSettings(browserStorage(), {
    mode: header.mode(),
    cells: gridPanel.cells(),
    gridWidth: orNull(gridPanel.gridWidth()),
    units: header.units(),
    measurements: {
      height: orNull(m.height),
      rings: m.rings.map((r) => ({ position: orNull(r.position), circumference: orNull(r.circumference) })),
    },
    placement: { width: orNull(p.width), verticalOffset: p.verticalOffset, rotation: p.rotation },
    slits: { count: slits.count, maxDepth: slits.depth },
    cut: slitPanel.cut(),
    ...exportPanel.options(),
    step,
  });
}

/** The steps for the current mode, design and warnings, from the step model. */
function stepList(): Step[] {
  return steps({ mode: header.mode(), tracing: designPanel.tracing(), hasImage: designPanel.hasImage(), warnings });
}

/** A tab or Back/Next picked a step. */
function goTo(next: StepId): void {
  step = next;
  enterStep();
  persist();
}

/** Show the current step's tab and panel, and switch the viewport to its default view. */
function enterStep(): void {
  const list = stepList();
  renderTabs(list);
  viewport.enter(list.find((s) => s.id === step)!);
}

/**
 * Follow the image design: loading an image, accepting its trace or going back to adjust it changes what
 * the viewport offers. On Design that re-enters the step (Trace while tracing, else 3D); on another step it
 * only updates the switcher, keeping the view the carver picked if it's still available.
 */
function followTrace(): void {
  const tracing = designPanel.tracing();
  const hasImage = designPanel.hasImage();
  if (tracing === lastTracing && hasImage === lastHasImage) return;
  lastTracing = tracing;
  lastHasImage = hasImage;
  const current = stepList().find((s) => s.id === step)!;
  if (step === "design") viewport.enter(current);
  else viewport.offer(current);
}

/** Show the step tabs, with a badge on each step that has a warning. */
function renderTabs(list = stepList()): void {
  tabs.render(list, step);
}

/** Show the current mode's inputs and keep the carver on the same step (Design and Grid stand in for each other). */
function syncMode(): void {
  app.classList.toggle("ball-mode", header.mode() === "test-grid");
  form.setBall(header.mode() === "test-grid");
  step = stepInMode(step, header.mode());
}

function changeMode(): void {
  syncMode();
  enterStep();
  update();
}

/** Show every length in the header's display units. Nothing is measured differently, so nothing is rebuilt. */
function showUnits(): void {
  const units = header.units();
  for (const panel of [form, gridPanel, designPanel, slitPanel, blueprint]) panel.setUnits(units);
  renderSurfaceInfo(infoEl, surface, units);
}

function changeUnits(): void {
  showUnits();
  if (built) drawPaper();
  persist();
}

/**
 * The shared measurements changed. The side that made the change already shows it; the other follows. During a
 * drag only the views follow: the 3D view and the template rebuild once, when it ends.
 */
function followMeasures(state: MeasureState, change: MeasureChange): void {
  if (change.source !== "form") form.show(state.measurements);
  if (!change.live) update();
}

function update(): void {
  followTrace();
  const ball = header.mode() === "test-grid";
  const state = measures.get();
  // A ball is measured by its first ring alone.
  const ballCircumference = state.measurements.rings[0]?.circumference ?? Number.NaN;
  const measurements = ball ? ballMeasurements(ballCircumference) : state.measurements;
  // The Blueprint view refits on every edit; it has its own empty and failed states.
  blueprint.show(state, ball);
  const design = ball ? gridDesign(gridPanel.cells()) : (designPanel.design() ?? undefined);
  const placement = ball ? { ...designPanel.placement(), width: gridPanel.gridWidth() } : designPanel.placement();
  // A grid is one solid carve area: no blank paper for slits.
  const slits = ball ? { count: 0, depth: 0 } : slitPanel.options();
  const cut = slitPanel.cut();
  const input = { measurements, design, placement, slits, margin: cut.margin };
  const quick = builder.preview(input);
  showWarnings(quick.warnings);
  surface = quick.surface;
  renderSurfaceInfo(infoEl, surface, header.units());
  preview.update(quick.surface, quick.design);
  if (!quick.surface) {
    viewport.setPlaceholder("Fix the measurements in the Measure step to see the pumpkin.");
    paper.empty("Fix the measurements in the Measure step to see the template.");
  } else if (!quick.design) {
    viewport.setPlaceholder("Load a design in the Design step to see it on the pumpkin.", "note");
    paper.empty("Load a design in the Design step to see the template.");
  } else viewport.setPlaceholder(null);
  if (quick.surface && quick.design) {
    pending = {
      surface: quick.surface,
      measurements,
      placement,
      slits,
      cut,
      ...(ball ? { calibrationBall: ballCircumference } : {}),
    };
    background.request(input);
    // The Paper view keeps the last template until the new one arrives.
    viewport.setStatus("Updating the template…");
    exportPanel.setUpdating();
  } else {
    pending = null;
    built = null;
    background.cancel();
    viewport.setStatus(null);
    exportPanel.setSource(null);
  }
  persist();
}

function showWarnings(next: TemplateWarning[]): void {
  warnings = next;
  form.showWarnings(warnings);
  designPanel.showWarnings(warnings);
  slitPanel.showWarnings(warnings);
  renderTabs();
}

/** The worker's template for the latest edit: stretch tint, slit warnings and export. */
function showTemplate(outcome: BuildOutcome): void {
  if (!pending) return;
  viewport.setStatus(null);
  if (!outcome.ok) {
    console.error("Template build failed:", outcome.message);
    slitPanel.showAutoCount(null);
    preview.setStretch(null);
    exportPanel.setFailed(outcome.message);
    built = null;
    paper.empty(`The template couldn't be built: ${outcome.message}`);
    return;
  }
  const { template, warnings: templateWarnings } = outcome;
  preview.setStretch(template?.stretch ?? null);
  slitPanel.showAutoCount(template && pending.slits.count === "auto" ? template.slits.length : null);
  // The same input as the quick preview, plus what only flattening finds (slits cut short).
  showWarnings(templateWarnings);
  built = template ? { template, ...pending } : null;
  exportPanel.setSource(built);
  drawPaper();
}

/**
 * The paper size or carve-area style changed: redraw the Paper view and remember the choice. With no template
 * the Paper view keeps its message (bad measurements, no design, a failed build or nothing on the pumpkin),
 * which doesn't depend on the paper.
 */
function changePaper(): void {
  if (built) drawPaper();
  persist();
}

/** Draw the latest template on its pages, split the way the PDF will split it. */
function drawPaper(): void {
  if (!built) {
    paper.empty("None of the design lands on the pumpkin, so there's no template yet.");
    return;
  }
  const options = exportPanel.options();
  paper.show(paperView({ ...built, ...options, units: header.units() }), options.filled);
}
