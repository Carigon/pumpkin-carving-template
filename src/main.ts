import "./ui/style.css";
import { buildTemplate, type PumpkinMeasurements } from "./core";
import { mountMeasurementForm } from "./ui/measurementForm";
import { renderSurfaceInfo } from "./ui/surfaceInfo";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <h1>Pumpkin carving template</h1>
  <section id="measurements"></section>
  <section id="surface-info" aria-live="polite"></section>
`;

const infoEl = app.querySelector<HTMLElement>("#surface-info")!;
const form = mountMeasurementForm(app.querySelector<HTMLElement>("#measurements")!, update);
update(form.read());

function update(measurements: PumpkinMeasurements): void {
  const result = buildTemplate({ measurements });
  form.showWarnings(result.warnings);
  renderSurfaceInfo(infoEl, result.surface);
}
