import type { Units } from "../core";
import { lengthFields } from "./lengthFields";

const DEFAULT_CELLS = 6;
/** Grid width seen from the front: small enough to stay inside 60° on a basketball (29.5 in around). */
const DEFAULT_GRID_WIDTH_IN = 5;

export interface GridPanel {
  /** Grid squares across (and down) in test-grid mode. */
  cells(): number;
  /** Width of the grid seen from the front, in the current units (NaN when empty). */
  gridWidth(): number;
  /** Convert the grid width when the measurement units change. */
  setUnits(units: Units): void;
  /** Put back a saved grid size (width in the current units). Doesn't call `onChange`. */
  restore(saved: { cells?: number; gridWidth?: number | null }): void;
}

/**
 * The test grid's size, for test-grid mode: the app models a ball from its circumference alone and replaces
 * the uploaded design with a square grid, so the printed template can be checked on a ball of known size.
 */
export function mountGridPanel(root: HTMLElement, onChange: () => void): GridPanel {
  root.innerHTML = `
    <form class="grid-size" novalidate>
      <div class="field">
        <label for="g-cells">Grid squares across</label>
        <div class="input-row">
          <input id="g-cells" type="number" inputmode="numeric" min="1" max="20" step="1" value="${DEFAULT_CELLS}" />
        </div>
      </div>
      <div class="field">
        <label for="g-width">Grid width seen from the front</label>
        <div class="input-row">
          <input id="g-width" type="number" inputmode="decimal" min="0" step="any" />
          <span class="unit-label">in</span>
        </div>
        <small class="hint">Enter the ball's circumference in Measure (a basketball is about 29.5 in).
          Print, tape the grid to the ball and check from the front that the squares look square and even.</small>
      </div>
    </form>
  `;
  const form = root.querySelector("form")!;
  const cellsInput = form.querySelector<HTMLInputElement>("#g-cells")!;
  const widthInput = form.querySelector<HTMLInputElement>("#g-width")!;
  const lengths = lengthFields(form, [widthInput]);
  lengths.set(widthInput, DEFAULT_GRID_WIDTH_IN);

  form.addEventListener("input", () => onChange());
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    restore(saved) {
      if (saved.cells !== undefined) cellsInput.value = String(saved.cells);
      if (saved.gridWidth !== undefined) lengths.set(widthInput, saved.gridWidth);
    },
    gridWidth: () => lengths.value(widthInput),
    setUnits: (units: Units) => lengths.setUnits(units),
    cells: () => {
      const n = Math.round(Number(cellsInput.value));
      return n >= 1 ? Math.min(n, 20) : DEFAULT_CELLS;
    },
  };
}
