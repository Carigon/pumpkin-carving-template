import type { Design, Placement, TemplateWarning, Units } from "../core";
import { readSvgDesign } from "../input/svgDesign";

const CM_PER_IN = 2.54;
const DEFAULTS_IN = { width: 6, verticalOffset: 0 };
const MAX_ROTATION = 30;

export interface DesignPanel {
  design(): Design | null;
  placement(): Placement;
  /** Convert the length fields when the measurement units change. */
  setUnits(units: Units): void;
  /** Show design-related warnings (outside the silhouette, past the front limit). */
  showWarnings(warnings: TemplateWarning[]): void;
}

/**
 * SVG upload plus placement controls: front-view width, vertical offset and rotation.
 * Calls `onChange` whenever the design or its placement changes.
 */
export function mountDesignPanel(root: HTMLElement, onChange: () => void): DesignPanel {
  root.innerHTML = `
    <h2>Design</h2>
    <form class="design" novalidate>
      <div class="field">
        <label for="d-file">SVG file</label>
        <input id="d-file" type="file" accept=".svg,image/svg+xml" />
        <small class="hint" id="d-file-status">Closed shapes become the carve areas.</small>
      </div>
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
        <small class="hint">Counterclockwise as seen from the front.</small>
      </div>
      <div id="d-warnings" class="warnings" role="alert"></div>
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

  width.value = String(DEFAULTS_IN.width);
  offset.value = String(DEFAULTS_IN.verticalOffset);
  let design: Design | null = null;
  let units: Units = "in";

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    const { design: read, notes } = readSvgDesign(await f.text());
    design = read;
    const count = read ? `${read.paths.length} shape${read.paths.length === 1 ? "" : "s"} loaded.` : "";
    status.textContent = [count, ...notes].filter(Boolean).join(" ");
    status.classList.toggle("warning-text", read === null);
    onChange();
  });
  rotationRange.addEventListener("input", () => {
    rotation.value = rotationRange.value;
  });
  rotation.addEventListener("input", () => {
    rotationRange.value = rotation.value;
  });
  form.addEventListener("input", (e) => {
    if (e.target !== file) onChange();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    design: () => design,
    placement: () => ({
      width: num(width.value),
      verticalOffset: num(offset.value) || 0,
      rotation: num(rotation.value) || 0,
    }),
    setUnits(next) {
      if (next === units) return;
      const factor = next === "cm" ? CM_PER_IN : 1 / CM_PER_IN;
      for (const el of [width, offset]) {
        const v = num(el.value);
        if (Number.isFinite(v)) el.value = String(Math.round(v * factor * 100) / 100);
      }
      form.querySelectorAll(".unit-label").forEach((el) => (el.textContent = next));
      units = next;
    },
    showWarnings(warnings) {
      const relevant = warnings.filter((w) => w.kind === "outside-silhouette" || w.kind === "past-front-limit");
      warningsEl.replaceChildren(
        ...relevant.map((w) => {
          const div = document.createElement("div");
          div.className = "warning";
          div.dataset.kind = w.kind;
          div.textContent = w.message;
          return div;
        }),
      );
    },
  };
}

function num(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}
