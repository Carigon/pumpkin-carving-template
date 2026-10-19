import { convertLength, defaultMargin, defaultSlits, type SlitOptions, type TemplateWarning, type Units } from "../core";
import { lengthFields } from "./lengthFields";
import { renderWarnings } from "./warnings";

/** Paper margin around the design (in the current units) and whether the PDF prints the solid cut-out edge. */
export interface CutOptions {
  margin: number;
  line: boolean;
}

/** Margins the carver can choose, in inches. */
const MARGIN_RANGE_IN = [0.25, 3] as const;

export interface SlitPanel {
  options(): SlitOptions;
  /** The margin and cut-line choice. An empty or out-of-range margin reads as the default (and is flagged). */
  cut(): CutOptions;
  /** Convert the length fields when the measurement units change. */
  setUnits(units: Units): void;
  /** Show slit warnings (slits shortened to stay clear of the design). */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Put back saved slit and cut-out options, in the current units. Doesn't call `onChange`. */
  restore(saved: Partial<SlitOptions>, cut?: Partial<CutOptions>): void;
}

/** The cut-out edge (margin, printed or not) and slit count and depth. Calls `onChange` whenever one changes. */
export function mountSlitPanel(root: HTMLElement, onChange: () => void): SlitPanel {
  const defaults = defaultSlits("in");
  root.innerHTML = `
    <form class="slits" novalidate>
      <section class="card">
      <h2>Cut-out edge</h2>
      <div class="field">
        <label for="s-margin">Margin around the design</label>
        <div class="input-row">
          <input id="s-margin" type="number" inputmode="decimal" min="0" step="any"
            value="${defaultMargin("in")}" aria-describedby="s-margin-hint s-margin-warning" />
          <span class="unit-label">in</span>
        </div>
        <div id="s-margin-hint" class="hint">Blank paper between the design and the cut-out edge.</div>
        <div id="s-margin-warning" class="warning" role="alert" hidden></div>
      </div>
      <div class="field checkbox">
        <label><input id="s-line" type="checkbox" checked /> Print the cut line (solid edge)</label>
      </div>
      </section>
      <section class="card slit-fields">
      <h2>Slits</h2>
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
        <div class="hint">Slits let the paper bend around the pumpkin.
          <details class="more"><summary>more</summary>They're printed dashed, run in from the cut-out edge and
            steer around the design. More or deeper slits reduce the stretch.</details>
        </div>
      </div>
      <div id="s-warnings" class="warnings" role="alert"></div>
      </section>
    </form>
  `;
  const form = root.querySelector("form")!;
  const count = form.querySelector<HTMLInputElement>("#s-count")!;
  const depth = form.querySelector<HTMLInputElement>("#s-depth")!;
  const margin = form.querySelector<HTMLInputElement>("#s-margin")!;
  const line = form.querySelector<HTMLInputElement>("#s-line")!;
  const marginWarning = form.querySelector<HTMLElement>("#s-margin-warning")!;
  const warningsEl = form.querySelector<HTMLElement>("#s-warnings")!;
  const lengths = lengthFields(form, [depth, margin]);

  /** The margin in the current units, or the default with a message when the field isn't a usable margin. */
  const readMargin = (): number => {
    const units = lengths.units();
    const [lo, hi] = MARGIN_RANGE_IN.map((v) => convertLength(v, "in", units));
    const m = lengths.value(margin);
    const ok = Number.isFinite(m) && m >= lo - 1e-9 && m <= hi + 1e-9;
    const fallback = defaultMargin(units);
    const round = (v: number) => Math.round(v * 100) / 100;
    marginWarning.textContent = ok
      ? ""
      : `Enter a margin from ${round(lo)} to ${round(hi)} ${units}. Using ${round(fallback)} ${units} for now.`;
    marginWarning.hidden = ok;
    margin.setAttribute("aria-invalid", String(!ok));
    return ok ? m : fallback;
  };

  // Typing in a field fires "input"; the checkbox is covered by "input" too in current browsers.
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
    cut: () => ({ margin: readMargin(), line: line.checked }),
    restore(saved, cut = {}) {
      if (saved.count !== undefined) count.value = String(saved.count);
      if (saved.depth !== undefined) lengths.set(depth, saved.depth);
      if (cut.margin !== undefined) lengths.set(margin, cut.margin);
      if (cut.line !== undefined) line.checked = cut.line;
    },
    setUnits: (next: Units) => lengths.setUnits(next),
    showWarnings: (warnings: TemplateWarning[]) => renderWarnings(warningsEl, warnings, "slits"),
  };
}
