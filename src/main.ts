import "./ui/style.css";
import { createTemplateBuilder, type TemplateWarning } from "./core";
import { ballMeasurements, gridDesign } from "./input/calibrationGrid";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountDesignPanel } from "./ui/designPanel";
import { mountExportPanel, type ExportSource } from "./ui/exportPanel";
import { mountGridPanel } from "./ui/gridPanel";
import { mountHeader } from "./ui/header";
import { mountMeasurementForm } from "./ui/measurementForm";
import { mountSlitPanel } from "./ui/slitPanel";
import { mountStepTabs } from "./ui/stepTabs";
import { renderSurfaceInfo } from "./ui/surfaceInfo";
import { mountViewport } from "./ui/viewport";
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
      <div id="surface-info" aria-live="polite"></div>
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
const form = mountMeasurementForm($("measurements"), update);
const gridPanel = mountGridPanel($("grid"), update);
const designPanel = mountDesignPanel($("design"), update);
const slitPanel = mountSlitPanel($("slits"), update);
const exportPanel = mountExportPanel($("export"), persist);
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
// The quick preview (projection alone) runs here on every edit; flattening runs in the worker.
const builder = createTemplateBuilder();
const background = startBackgroundBuild(showTemplate);
/** The export details of the latest edit, to pair with the worker's template when it arrives. */
let pending: Omit<ExportSource, "template"> | null = null;
restore();
syncMode();
enterStep();
update();

/** Put back the last-used settings. Units go first so the length fields are read in the saved units. */
function restore(): void {
  const saved = loadSettings(browserStorage());
  header.restore(saved);
  form.restore({ units: saved.units, ...saved.measurements });
  if (saved.units) {
    gridPanel.setUnits(saved.units);
    designPanel.setUnits(saved.units);
    slitPanel.setUnits(saved.units);
  }
  gridPanel.restore(saved);
  designPanel.restorePlacement(saved.placement ?? {});
  slitPanel.restore(saved.slits ?? {}, saved.cut);
  exportPanel.restore(saved);
  if (saved.step) step = saved.step;
}

/** Remember the current settings (never the design). */
function persist(): void {
  const m = form.read();
  const p = designPanel.placement();
  const orNull = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : null);
  saveSettings(browserStorage(), {
    mode: header.mode(),
    cells: gridPanel.cells(),
    gridWidth: orNull(gridPanel.gridWidth()),
    units: m.units,
    measurements: {
      height: orNull(m.height),
      rings: m.rings.map((r) => ({ position: orNull(r.position), circumference: orNull(r.circumference) })),
    },
    placement: { width: orNull(p.width), verticalOffset: p.verticalOffset, rotation: p.rotation },
    slits: slitPanel.options(),
    cut: slitPanel.cut(),
    ...exportPanel.options(),
    step,
  });
}

/** The steps for the current mode and design, from the step model. */
function stepList(): Step[] {
  return steps({ mode: header.mode(), tracing: designPanel.tracing() });
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
  tabs.render(list, step);
  viewport.enter(list.find((s) => s.id === step)!);
}

/** Show the current mode's inputs and keep the carver on the same step (Design and Grid stand in for each other). */
function syncMode(): void {
  app.classList.toggle("ball-mode", header.mode() === "test-grid");
  step = stepInMode(step, header.mode());
}

function changeMode(): void {
  syncMode();
  enterStep();
  update();
}

function changeUnits(): void {
  // The other panels follow the form's units in `update`.
  form.setUnits(header.units());
  update();
}

function update(): void {
  const ball = header.mode() === "test-grid";
  const read = form.read();
  // A ball is measured by its first ring alone.
  const ballCircumference = read.rings[0]?.circumference ?? Number.NaN;
  const measurements = ball ? ballMeasurements(ballCircumference, read.units) : read;
  gridPanel.setUnits(measurements.units);
  designPanel.setUnits(measurements.units);
  slitPanel.setUnits(measurements.units);
  const design = ball ? gridDesign(gridPanel.cells()) : (designPanel.design() ?? undefined);
  const placement = ball ? { ...designPanel.placement(), width: gridPanel.gridWidth() } : designPanel.placement();
  // A grid is one solid carve area: no blank paper for slits.
  const slits = ball ? { count: 0, depth: 0 } : slitPanel.options();
  const cut = slitPanel.cut();
  const input = { measurements, design, placement, slits, margin: cut.margin };
  const quick = builder.preview(input);
  showWarnings(quick.warnings);
  renderSurfaceInfo(infoEl, quick.surface);
  preview.update(quick.surface, quick.design);
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
    viewport.setStatus("Stretch tint: updating…");
    exportPanel.setUpdating();
  } else {
    pending = null;
    background.cancel();
    viewport.setStatus(null);
    exportPanel.setSource(null);
  }
  // Last, so the design and slit lengths have already been converted to the current units.
  persist();
}

function showWarnings(warnings: TemplateWarning[]): void {
  form.showWarnings(warnings);
  designPanel.showWarnings(warnings);
  slitPanel.showWarnings(warnings);
}

/** The worker's template for the latest edit: stretch tint, slit warnings and export. */
function showTemplate(outcome: BuildOutcome): void {
  if (!pending) return;
  viewport.setStatus(null);
  if (!outcome.ok) {
    console.error("Template build failed:", outcome.message);
    preview.setStretch(null);
    exportPanel.setFailed(outcome.message);
    return;
  }
  const { template, warnings } = outcome;
  preview.setStretch(template?.stretch ?? null);
  // The same input as the quick preview, plus what only flattening finds (slits cut short).
  showWarnings(warnings);
  exportPanel.setSource(template ? { template, ...pending } : null);
}
