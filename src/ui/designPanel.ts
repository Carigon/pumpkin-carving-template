import type { Design, Placement, TemplateWarning, Units } from "../core";
import { readSvgDesign } from "../input/svgDesign";
import { lengthFields } from "./lengthFields";
import { mountTracePanel } from "./tracePanel";
import { renderWarnings } from "./warnings";

const DEFAULTS_IN = { width: 6, verticalOffset: 0 };
const MAX_ROTATION = 30;

export interface DesignPanel {
  design(): Design | null;
  placement(): Placement;
  /** An image design is loaded and still being traced (the carver hasn't accepted the trace). */
  tracing(): boolean;
  /** An image design is loaded, being traced or with its trace accepted. */
  hasImage(): boolean;
  /** Convert the length fields when the measurement units change. */
  setUnits(units: Units): void;
  /** Show design-related warnings (outside the silhouette, past the front limit). */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Put back saved placement values (width null = empty), in the current units. Doesn't call `onChange`. */
  restorePlacement(saved: Partial<{ width: number | null; verticalOffset: number; rotation: number }>): void;
}

/**
 * SVG upload plus placement controls: front-view width, vertical offset and rotation.
 * Calls `onChange` whenever the design or its placement changes, or the trace is accepted. An image's crop
 * and traced result go in `traceView` (the viewport's Trace view).
 */
export function mountDesignPanel(root: HTMLElement, onChange: () => void, traceView: HTMLElement): DesignPanel {
  root.innerHTML = `
    <form class="design" novalidate>
      <section class="card design-source">
      <h2>Design</h2>
      <div class="field">
        <label for="d-file">SVG file or scanned stencil</label>
        <input id="d-file" type="file" accept=".svg,image/svg+xml,image/*" />
        <div class="hint" id="d-file-status">Closed shapes become the carve areas. Images are traced in your browser.</div>
      </div>
      <div id="d-trace"></div>
      </section>
      <section class="card">
      <h2>Placement</h2>
      <div class="field">
        <label for="d-width">Width seen from the front</label>
        <div class="input-row">
          <input id="d-width" type="number" inputmode="decimal" min="0" step="any" />
          <span class="unit-label">in</span>
        </div>
      </div>
      <div class="field">
        <label for="d-offset">Move up (negative = down)</label>
        <div class="input-row">
          <input id="d-offset" type="number" inputmode="decimal" step="any" />
          <span class="unit-label">in</span>
        </div>
      </div>
      <div class="field">
        <label for="d-rotation">Rotation</label>
        <div class="input-row">
          <input id="d-rotation-range" type="range" min="${-MAX_ROTATION}" max="${MAX_ROTATION}" step="0.5" value="0"
            aria-label="Rotation slider" />
          <input id="d-rotation" type="number" step="0.5" value="0" />
          <span>°</span>
        </div>
        <div class="hint">Counterclockwise as seen from the front.</div>
      </div>
      <div id="d-warnings" class="warnings" role="alert"></div>
      </section>
    </form>
  `;

  const form = root.querySelector("form")!;
  const $ = <T extends HTMLElement>(id: string) => form.querySelector<T>(`#${id}`)!;
  const file = $<HTMLInputElement>("d-file");
  const status = $<HTMLElement>("d-file-status");
  const width = $<HTMLInputElement>("d-width");
  const offset = $<HTMLInputElement>("d-offset");
  const rotation = $<HTMLInputElement>("d-rotation");
  const rotationRange = $<HTMLInputElement>("d-rotation-range");
  const warningsEl = $<HTMLElement>("d-warnings");

  const lengths = lengthFields(form, [width, offset]);
  lengths.set(width, DEFAULTS_IN.width);
  lengths.set(offset, DEFAULTS_IN.verticalOffset);
  let design: Design | null = null;
  const showStatus = (text: string, failed: boolean) => {
    status.textContent = text;
    status.classList.toggle("warning-text", failed);
  };
  const traceEl = $<HTMLElement>("d-trace");
  const trace = mountTracePanel(
    traceEl,
    (traced, text, failed) => {
      design = traced;
      showStatus(text, failed);
      onChange();
    },
    traceView,
    onChange,
  );

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.type.startsWith("image/") && f.type !== "image/svg+xml") {
      design = null;
      showStatus("Tracing…", false);
      onChange();
      await trace.load(f);
      return;
    }
    trace.clear();
    const { design: read, notes } = readSvgDesign(await f.text());
    design = read;
    const count = read ? `${read.paths.length} shape${read.paths.length === 1 ? "" : "s"} loaded.` : "";
    showStatus([count, ...notes].filter(Boolean).join(" "), read === null);
    onChange();
  });
  rotationRange.addEventListener("input", () => {
    rotation.value = rotationRange.value;
  });
  rotation.addEventListener("input", () => {
    rotationRange.value = rotation.value;
  });
  form.addEventListener("input", (e) => {
    if (e.target !== file && !traceEl.contains(e.target as Node)) onChange();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    design: () => design,
    tracing: () => trace.loaded() && !trace.accepted(),
    hasImage: () => trace.loaded(),
    placement: () => ({
      width: lengths.value(width),
      verticalOffset: lengths.value(offset) || 0,
      rotation: num(rotation.value) || 0,
    }),
    restorePlacement(saved) {
      if (saved.width !== undefined) lengths.set(width, saved.width);
      if (saved.verticalOffset !== undefined) lengths.set(offset, saved.verticalOffset);
      if (saved.rotation !== undefined) rotation.value = rotationRange.value = String(saved.rotation);
    },
    setUnits: (next: Units) => lengths.setUnits(next),
    showWarnings: (warnings: TemplateWarning[]) => renderWarnings(warningsEl, warnings, "design"),
  };
}

function num(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}
