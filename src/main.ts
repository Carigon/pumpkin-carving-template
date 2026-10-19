import "./ui/style.css";
import { buildTemplate } from "./core";
import { mountPumpkinPreview } from "./preview/pumpkinPreview";
import { mountDesignPanel } from "./ui/designPanel";
import { mountMeasurementForm } from "./ui/measurementForm";
import { renderSurfaceInfo } from "./ui/surfaceInfo";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <h1>Pumpkin carving template</h1>
  <section id="measurements"></section>
  <section id="design"></section>
  <section id="preview">
    <h2>Preview</h2>
    <canvas id="preview-canvas" aria-label="3D preview of the design on the pumpkin. Drag to orbit."></canvas>
    <small class="hint">Drag to orbit, scroll to zoom. Dark lines: design. Gold: past about 60° from the front.
      Red dots: points that miss the pumpkin.</small>
  </section>
  <section id="surface-info" aria-live="polite"></section>
`;

const infoEl = app.querySelector<HTMLElement>("#surface-info")!;
const preview = mountPumpkinPreview(app.querySelector<HTMLCanvasElement>("#preview-canvas")!);
const form = mountMeasurementForm(app.querySelector<HTMLElement>("#measurements")!, update);
const designPanel = mountDesignPanel(app.querySelector<HTMLElement>("#design")!, update);
update();

function update(): void {
  const measurements = form.read();
  designPanel.setUnits(measurements.units);
  const design = designPanel.design() ?? undefined;
  const result = buildTemplate({ measurements, design, placement: designPanel.placement() });
  form.showWarnings(result.warnings);
  designPanel.showWarnings(result.warnings);
  renderSurfaceInfo(infoEl, result.surface);
  preview.update(result.surface, result.design);
}
