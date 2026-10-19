import "./ui/style.css";
import { buildTemplate } from "./core";
import { ballMeasurements, gridDesign } from "./input/calibrationGrid";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountDesignPanel } from "./ui/designPanel";
import { mountExportPanel } from "./ui/exportPanel";
import { mountMeasurementForm } from "./ui/measurementForm";
import { mountModePanel } from "./ui/modePanel";
import { mountSlitPanel } from "./ui/slitPanel";
import { renderSurfaceInfo } from "./ui/surfaceInfo";
import { browserStorage, loadSettings, saveSettings } from "./settings";

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
  </section>
  <section id="export"></section>
  <section id="surface-info" aria-live="polite"></section>
`;

const infoEl = app.querySelector<HTMLElement>("#surface-info")!;
const preview = mountPumpkinPreview(app.querySelector<HTMLCanvasElement>("#preview-canvas")!);
const modePanel = mountModePanel(app.querySelector<HTMLElement>("#mode")!, app, update);
const form = mountMeasurementForm(app.querySelector<HTMLElement>("#measurements")!, update);
const designPanel = mountDesignPanel(app.querySelector<HTMLElement>("#design")!, update);
const slitPanel = mountSlitPanel(app.querySelector<HTMLElement>("#slits")!, update);
const exportPanel = mountExportPanel(app.querySelector<HTMLElement>("#export")!, persist);
restore();
update();

/** Put back the last-used settings. Units go first so the length fields are read in the saved units. */
function restore(): void {
  const saved = loadSettings(browserStorage());
  form.restore({ units: saved.units, values: saved.measurements });
  if (saved.units) {
    modePanel.setUnits(saved.units);
    designPanel.setUnits(saved.units);
    slitPanel.setUnits(saved.units);
  }
  modePanel.restore(saved);
  designPanel.restorePlacement(saved.placement ?? {});
  slitPanel.restore(saved.slits ?? {});
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
    measurements: { circumference: orNull(m.circumference), frontArc: orNull(m.frontArc), depth: orNull(m.depth) },
    placement: { width: orNull(p.width), verticalOffset: p.verticalOffset, rotation: p.rotation },
    slits: slitPanel.options(),
    ...exportPanel.options(),
  });
}

function update(): void {
  const ball = modePanel.mode() === "test-grid";
  const read = form.read();
  const measurements = ball ? ballMeasurements(read.circumference, read.units) : read;
  modePanel.setUnits(measurements.units);
  designPanel.setUnits(measurements.units);
  slitPanel.setUnits(measurements.units);
  const design = ball ? gridDesign(modePanel.cells()) : (designPanel.design() ?? undefined);
  const placement = ball ? { ...designPanel.placement(), width: modePanel.gridWidth() } : designPanel.placement();
  // A grid is one solid carve area: no blank paper for slits.
  const slits = ball ? { count: 0, depth: 0 } : slitPanel.options();
  const result = buildTemplate({ measurements, design, placement, slits });
  form.showWarnings(result.warnings);
  designPanel.showWarnings(result.warnings);
  slitPanel.showWarnings(result.warnings);
  renderSurfaceInfo(infoEl, result.surface);
  preview.update(result.surface, result.design, result.template?.stretch ?? null);
  exportPanel.setSource(
    result.template && result.surface
      ? {
          template: result.template,
          surface: result.surface,
          measurements,
          placement,
          slits,
          ...(ball ? { calibrationBall: measurements.circumference } : {}),
        }
      : null,
  );
  // Last, so the design and slit lengths have already been converted to the current units.
  persist();
}
