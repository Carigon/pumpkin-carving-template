import { defaultSlits, type SlitOptions, type TemplateWarning, type Units } from "../core";
import { lengthFields } from "./lengthFields";
import { renderWarnings } from "./warnings";

export interface SlitPanel {
  options(): SlitOptions;
  /** Convert the depth field when the measurement units change. */
  setUnits(units: Units): void;
  /** Show slit warnings (slits shortened to stay clear of the design). */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Put back saved slit options, in the current units. Doesn't call `onChange`. */
  restore(saved: Partial<SlitOptions>): void;
}

/** Slit count and depth. Calls `onChange` whenever either changes. */
export function mountSlitPanel(root: HTMLElement, onChange: () => void): SlitPanel {
  const defaults = defaultSlits("in");
  root.innerHTML = `
    <h2>Slits</h2>
    <form class="slits" novalidate>
      <div class="field">
        <label for="s-count">Number of slits</label>
        <div class="input-row">
          <input id="s-count" type="number" inputmode="numeric" min="0" max="24" step="1" value="${defaults.count}" />
        </div>
      </div>
      <div class="field">
        <label for="s-depth">Slit depth (in from the cut-out edge)</label>
        <div class="input-row">
          <input id="s-depth" type="number" inputmode="decimal" min="0" step="any" value="${defaults.depth}" />
          <span class="unit-label">in</span>
        </div>
        <small class="hint">Slits let the paper bend around the pumpkin. They're printed dashed and steer around the design.</small>
      </div>
      <div id="s-warnings" class="warnings" role="alert"></div>
    </form>
  `;
  const form = root.querySelector("form")!;
  const count = form.querySelector<HTMLInputElement>("#s-count")!;
  const depth = form.querySelector<HTMLInputElement>("#s-depth")!;
  const warningsEl = form.querySelector<HTMLElement>("#s-warnings")!;
  const lengths = lengthFields(form, [depth]);

  form.addEventListener("input", () => onChange());
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    options() {
      const fallback = defaultSlits(lengths.units());
      const n = Number(count.value), d = lengths.value(depth);
      return {
        count: count.value.trim() !== "" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback.count,
        depth: Number.isFinite(d) ? Math.max(0, d) : fallback.depth,
      };
    },
    restore(saved) {
      if (saved.count !== undefined) count.value = String(saved.count);
      if (saved.depth !== undefined) lengths.set(depth, saved.depth);
    },
    setUnits: (next: Units) => lengths.setUnits(next),
    showWarnings: (warnings: TemplateWarning[]) => renderWarnings(warningsEl, warnings, "slits"),
  };
}
