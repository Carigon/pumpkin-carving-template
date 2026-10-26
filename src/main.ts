import "./ui/style.css";
import { createTemplateBuilder, type SurfaceParameters, type TemplateWarning } from "./core";
import { gridDesign } from "./input/calibrationGrid";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountBlueprintView } from "./ui/blueprintViewSvg";
import { mountDeleteConfirm } from "./ui/deleteConfirm";
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
import { isShapeWarning } from "./ui/warnings";
import {
  createMeasureStore,
  editPatch,
  EMPTY_MEASURE_STATE,
  shapeMeasurements,
  startingMeasurements,
  type MeasureChange,
  type MeasureState,
} from "./measureState";
import type { RingMeasurements } from "./ringEdits";
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
const header = mountHeader($("header"), changeMode, changeUnits, persist);
const viewport = mountViewport($("viewport"), followHold);
const preview = mountPumpkinPreview(viewport.canvas);
const paper = mountPaperView(viewport.paperView);
// The measurements the form and the Blueprint view both render from and edit.
const measures = createMeasureStore(EMPTY_MEASURE_STATE);
/** The measurements the form shows, for `followMeasures` to tell when they change. */
let formShows: RingMeasurements | null = null;
/** The measurements the 3D view and the template were last built from (by `update`). */
let builtFrom: RingMeasurements | null = null;
// Asking before a ring's × (the form's or the view's) deletes it, as the header's settings menu says; "Don't ask
// again" unticks it there.
const confirmDelete = mountDeleteConfirm(document.body, {
  asking: () => header.askBeforeDeletingRing(),
  stopAsking() {
    header.setAskBeforeDeletingRing(false);
    persist();
  },
});
const fromForm: MeasureChange = { source: "form", live: false };
const form = mountMeasurementForm(
  $("measurements"),
  (measurements, edited) => measures.set(editPatch(measurements, edited), fromForm),
  {
    select: (selected) => measures.set({ selected }, fromForm),
    hover: (hovered) => measures.set({ hovered }, fromForm),
    confirmDelete,
  },
);
const blueprint = mountBlueprintView(viewport.blueprintView, {
  change: (patch, live) => measures.set(patch, { source: "view", live }),
  confirmDelete,
});
const gridPanel = mountGridPanel($("grid"), update);
const designPanel = mountDesignPanel($("design"), update, viewport.photoView, viewport.pageView);
const slitPanel = mountSlitPanel($("slits"), update);
const exportPanel = mountExportPanel($("export"), () => header.units(), changePaper);
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
let lastHasPage = false;
/** Whether `update` last held the slow template build back (the hand-trace canvas was showing). */
let lastHeld = false;
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
  measures.set({ ...EMPTY_MEASURE_STATE, measurements }, fromForm);
  form.show(measurements);
  formShows = measurements;
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
    askBeforeDeletingRing: header.askBeforeDeletingRing(),
  });
}

/** The steps for the current mode, design and warnings, from the step model. */
function stepList(): Step[] {
  return steps({
    mode: header.mode(),
    tracing: designPanel.tracing(),
    hasImage: designPanel.hasImage(),
    hasPage: designPanel.hasPage(),
    warnings,
  });
}

/** A tab or Back/Next picked a step. */
function goTo(next: StepId): void {
  step = next;
  enterStep();
  persist();
  followHold();
}

/**
 * The slow template build is held while the hand-trace canvas is showing (the Page view, not Done), so tracing
 * doesn't drain a phone's battery. It runs once the carver leaves that view or presses Done.
 */
function buildHeld(): boolean {
  return viewport.current() === "page" && designPanel.tracing();
}

/** The view changed: build the template now if leaving the hand-trace canvas released it. */
function followHold(): void {
  if (buildHeld() !== lastHeld) update();
}

/** Show the current step's tab and panel, and switch the viewport to its default view. */
function enterStep(): void {
  const list = stepList();
  renderTabs(list);
  viewport.enter(list.find((s) => s.id === step)!);
}

/**
 * Follow the photo or blank page: loading one, pressing Done or going back to Edit changes what the viewport
 * offers. On Design that re-enters the step (the Photo or Page view while tracing, else 3D); on another step it
 * only updates the switcher, keeping the view the carver picked if it's still available.
 */
function followTrace(): void {
  const tracing = designPanel.tracing();
  const hasImage = designPanel.hasImage();
  const hasPage = designPanel.hasPage();
  if (tracing === lastTracing && hasImage === lastHasImage && hasPage === lastHasPage) return;
  lastTracing = tracing;
  lastHasImage = hasImage;
  lastHasPage = hasPage;
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
  const ball = ballMode();
  app.classList.toggle("ball-mode", ball);
  form.setBall(ball);
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
 * The shared state changed. The side that made the change already shows it; the other follows. During a drag
 * (or a held arrow key) only the views follow: the 3D view and the template rebuild when it ends. A change of
 * selection or hover alone rebuilds nothing.
 */
function followMeasures(state: MeasureState, change: MeasureChange): void {
  formFollowsMeasurements(state, change);
  // The form shows the selection and hover from either side, scrolling to a ring selected in the view (focus
  // stays where it is).
  form.showLinks(state.selected, state.hovered, change.source === "view");
  if (editEnded(state, change)) update();
  else if (change.source === "form") blueprint.show(state, ballMode());
}

/** New measurements from the view (a drag, nudge, insert or delete) show in the form; the form shows its own. */
function formFollowsMeasurements(state: MeasureState, change: MeasureChange): void {
  if (state.measurements === formShows) return;
  formShows = state.measurements;
  if (change.source === "view") form.show(state.measurements);
}

/** An edit is over (no drag or held key still going) and the 3D view and the template aren't built from it yet. */
function editEnded(state: MeasureState, change: MeasureChange): boolean {
  return !change.live && state.measurements !== builtFrom;
}

/** Test-grid mode: the pumpkin is a ball, measured by its first ring. */
function ballMode(): boolean {
  return header.mode() === "test-grid";
}

function update(): void {
  followTrace();
  const ball = ballMode();
  const state = measures.get();
  builtFrom = state.measurements;
  const measurements = shapeMeasurements(state.measurements, ball);
  // The Blueprint view refits on every edit; it has its own empty and failed states.
  blueprint.show(state, ball);
  const design = ball ? gridDesign(gridPanel.cells()) : (designPanel.design() ?? undefined);
  const placement = ball ? { ...designPanel.placement(), width: gridPanel.gridWidth() } : designPanel.placement();
  // A grid is one solid carve area: no blank paper for slits.
  const slits = ball ? { count: 0, depth: 0 } : slitPanel.options();
  const cut = slitPanel.cut();
  const input = { measurements, design, placement, slits, margin: cut.margin };
  const quick = builder.preview(input);
  // The hand-trace's open shapes (null without one): not in the design, so the 3D view says they aren't carved.
  const open = ball ? null : designPanel.openShapes();
  showWarnings(quick.warnings);
  surface = quick.surface;
  renderSurfaceInfo(infoEl, surface, header.units());
  preview.update(quick.surface, quick.design);
  if (!quick.surface) {
    viewport.setPlaceholder("Fix the measurements in the Measure step to see the pumpkin.");
    paper.empty("Fix the measurements in the Measure step to see the template.");
  } else if (!quick.design && open !== null) {
    viewport.setPlaceholder(
      ["Close a shape in the Page view to see it on the pumpkin.", openNote(open)].filter(Boolean).join(" "),
      "note",
    );
    paper.empty("Close a shape in the Page view to see the template.");
  } else if (!quick.design) {
    viewport.setPlaceholder("Load a design in the Design step to see it on the pumpkin.", "note");
    paper.empty("Load a design in the Design step to see the template.");
  } else viewport.setPlaceholder(openNote(open) || null, "note");
  lastHeld = buildHeld();
  if (quick.surface && quick.design && lastHeld) {
    // Held while the hand-trace canvas shows: the template catches up when the carver leaves it or presses Done.
    background.cancel();
    viewport.setStatus(null);
    exportPanel.setUpdating();
  } else if (quick.surface && quick.design) {
    pending = {
      surface: quick.surface,
      measurements,
      placement,
      slits,
      cut,
      ...(ball ? { calibrationBall: measurements.rings[0].circumference } : {}),
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

/** The 3D view's note about open shapes, or "" with none. */
function openNote(open: number | null): string {
  if (!open) return "";
  return open === 1 ? "1 open shape isn't carved." : `${open} open shapes aren't carved.`;
}

function showWarnings(next: TemplateWarning[]): void {
  // A test grid is printed, not carved: its cells are meant to be kept paper, not floating pieces.
  warnings = ballMode() ? next.filter((w) => !isShapeWarning(w)) : next;
  // A failed fit marks the row of the ring edited last; none since the page loaded marks no row.
  form.showWarnings(warnings, measures.get().lastEdited);
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
