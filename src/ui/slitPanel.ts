import { defaultSlits, type SlitOptions, type TemplateWarning, type Units } from "../core";

const CM_PER_IN = 2.54;

export interface SlitPanel {
  options(): SlitOptions;
  /** Convert the depth field when the measurement units change. */
  setUnits(units: Units): void;
  /** Show slit warnings (slits shortened to stay clear of the design). */
  showWarnings(warnings: TemplateWarning[]): void;
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
  let units: Units = "in";

  form.addEventListener("input", () => onChange());
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    options() {
      const fallback = defaultSlits(units);
      const n = Number(count.value), d = Number(depth.value);
      return {
        count: count.value.trim() !== "" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback.count,
        depth: depth.value.trim() !== "" && Number.isFinite(d) ? Math.max(0, d) : fallback.depth,
      };
    },
    setUnits(next) {
      if (next === units) return;
      const v = Number(depth.value);
      if (depth.value.trim() !== "" && Number.isFinite(v)) {
        depth.value = String(Math.round(v * (next === "cm" ? CM_PER_IN : 1 / CM_PER_IN) * 100) / 100);
      }
      form.querySelectorAll(".unit-label").forEach((el) => (el.textContent = next));
      units = next;
    },
    showWarnings(warnings) {
      warningsEl.replaceChildren(
        ...warnings
          .filter((w) => w.kind === "slit-shortened")
          .map((w) => {
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
