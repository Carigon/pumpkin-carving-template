import "./ui/style.css";
import { buildTemplate } from "./core";
import { ballMeasurements, gridDesign } from "./input/calibrationGrid";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountDesignPanel } from "./ui/designPanel";
import { mountExportPanel } from "./ui/exportPanel";
import { mountMeasurementForm } from "./ui/measurementForm";
import { mountModePanel } from "./ui/modePanel";
import { renderSurfaceInfo } from "./ui/surfaceInfo";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <h1>Pumpkin carving template</h1>
  <section id="mode"></section>
  <section id="measurements"></section>
  <section id="design"></section>
  <section id="preview">
    <h2>Preview</h2>
    <canvas id="preview-canvas" aria-label="3D preview of the design on the pumpkin. Drag to orbit."></canvas>
    <small class="hint">Drag to orbit, scroll to zoom. Dark lines: design. Gold: past about 60° from the front.
      Red dots: points that miss the pumpkin.</small>
  </section>
  <section id="export"></section>
  <section id="surface-info" aria-live="polite"></section>
`;

const infoEl = app.querySelector<HTMLElement>("#surface-info")!;
const preview = mountPumpkinPreview(app.querySelector<HTMLCanvasElement>("#preview-canvas")!);
const modePanel = mountModePanel(app.querySelector<HTMLElement>("#mode")!, app, update);
const form = mountMeasurementForm(app.querySelector<HTMLElement>("#measurements")!, update);
const designPanel = mountDesignPanel(app.querySelector<HTMLElement>("#design")!, update);
const exportPanel = mountExportPanel(app.querySelector<HTMLElement>("#export")!);
update();

function update(): void {
  const ball = modePanel.mode() === "test-grid";
  const read = form.read();
  const measurements = ball ? ballMeasurements(read.circumference, read.units) : read;
  designPanel.setUnits(measurements.units);
  const design = ball ? gridDesign(modePanel.cells()) : (designPanel.design() ?? undefined);
  const placement = designPanel.placement();
  const result = buildTemplate({ measurements, design, placement });
  form.showWarnings(result.warnings);
  designPanel.showWarnings(result.warnings);
  renderSurfaceInfo(infoEl, result.surface);
  preview.update(result.surface, result.design, result.template?.stretch ?? null);
  exportPanel.setSource(
    result.template && result.surface
      ? {
          template: result.template,
          surface: result.surface,
          measurements,
          placement,
          ...(ball ? { calibrationBall: measurements.circumference } : {}),
        }
      : null,
  );
}
