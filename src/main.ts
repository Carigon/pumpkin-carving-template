import "./ui/style.css";
import { createTemplateBuilder, type TemplateWarning } from "./core";
import { ballMeasurements, gridDesign } from "./input/calibrationGrid";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountDesignPanel } from "./ui/designPanel";
import { mountExportPanel, type ExportSource } from "./ui/exportPanel";
import { mountMeasurementForm } from "./ui/measurementForm";
import { mountModePanel } from "./ui/modePanel";
import { mountSlitPanel } from "./ui/slitPanel";
import { renderSurfaceInfo } from "./ui/surfaceInfo";
import { browserStorage, loadSettings, saveSettings } from "./settings";
import { startBackgroundBuild, type BuildOutcome } from "./worker/backgroundBuild";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <h1>Pumpkin carving template</h1>
  <section id="mode"></section>
  <section id="measurements"></section>
  <section id="design"></section>
  <section id="slits"></section>
  <section id="preview">
    <h2>Preview</h2>
    <canvas id="preview-canvas" aria-label="3D preview of the design on the pumpkin. Drag to orbit."></canvas>
    <small class="hint">Drag to orbit, scroll to zoom. Dark lines: design. Gold: past about 60° from the front.
      Red dots: points that miss the pumpkin. Crimson tint: where the paper has to stretch or squeeze to lie on
      the pumpkin (faint from about 3 %, solid from 15 %); lines there won't land exactly. Smaller designs or
      more, deeper slits reduce it.</small>
    <small class="hint" id="stretch-status" aria-live="polite" hidden></small>
  </section>
  <section id="export"></section>
  <section id="surface-info" aria-live="polite"></section>
`;

const infoEl = app.querySelector<HTMLElement>("#surface-info")!;
const stretchStatus = app.querySelector<HTMLElement>("#stretch-status")!;
const preview = mountPumpkinPreview(app.querySelector<HTMLCanvasElement>("#preview-canvas")!);
const modePanel = mountModePanel(app.querySelector<HTMLElement>("#mode")!, app, update);
const form = mountMeasurementForm(app.querySelector<HTMLElement>("#measurements")!, update);
const designPanel = mountDesignPanel(app.querySelector<HTMLElement>("#design")!, update);
const slitPanel = mountSlitPanel(app.querySelector<HTMLElement>("#slits")!, update);
const exportPanel = mountExportPanel(app.querySelector<HTMLElement>("#export")!, persist);
// The quick preview (projection alone) runs here on every edit; flattening runs in the worker.
const builder = createTemplateBuilder();
const background = startBackgroundBuild(showTemplate);
/** The export details of the latest edit, to pair with the worker's template when it arrives. */
let pending: Omit<ExportSource, "template"> | null = null;
restore();
update();

/** Put back the last-used settings. Units go first so the length fields are read in the saved units. */
function restore(): void {
  const saved = loadSettings(browserStorage());
  form.restore({ units: saved.units, ...saved.measurements });
  if (saved.units) {
    modePanel.setUnits(saved.units);
    designPanel.setUnits(saved.units);
    slitPanel.setUnits(saved.units);
  }
  modePanel.restore(saved);
  designPanel.restorePlacement(saved.placement ?? {});
  slitPanel.restore(saved.slits ?? {}, saved.cut);
  exportPanel.restore(saved);
}

/** Remember the current settings (never the design). */
function persist(): void {
  const m = form.read();
  const p = designPanel.placement();
  const orNull = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : null);
  saveSettings(browserStorage(), {
    mode: modePanel.mode(),
    cells: modePanel.cells(),
    gridWidth: orNull(modePanel.gridWidth()),
    units: m.units,
    measurements: {
      height: orNull(m.height),
      rings: m.rings.map((r) => ({ position: orNull(r.position), circumference: orNull(r.circumference) })),
    },
    placement: { width: orNull(p.width), verticalOffset: p.verticalOffset, rotation: p.rotation },
    slits: slitPanel.options(),
    cut: slitPanel.cut(),
    ...exportPanel.options(),
  });
}

function update(): void {
  const ball = modePanel.mode() === "test-grid";
  const read = form.read();
  // A ball is measured by its first ring alone.
  const ballCircumference = read.rings[0]?.circumference ?? Number.NaN;
  const measurements = ball ? ballMeasurements(ballCircumference, read.units) : read;
  modePanel.setUnits(measurements.units);
  designPanel.setUnits(measurements.units);
  slitPanel.setUnits(measurements.units);
  const design = ball ? gridDesign(modePanel.cells()) : (designPanel.design() ?? undefined);
  const placement = ball ? { ...designPanel.placement(), width: modePanel.gridWidth() } : designPanel.placement();
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
    stretchStatus.textContent = "Stretch tint: updating…";
    stretchStatus.hidden = false;
    exportPanel.setUpdating();
  } else {
    pending = null;
    background.cancel();
    stretchStatus.hidden = true;
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
  stretchStatus.hidden = true;
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
