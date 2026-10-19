import type { Units } from "../core";
import { lengthFields } from "./lengthFields";

export type Mode = "pumpkin" | "test-grid";

const DEFAULT_CELLS = 6;
/** Grid width seen from the front: small enough to stay inside 60° on a basketball (29.5 in around). */
const DEFAULT_GRID_WIDTH_IN = 5;

export interface ModePanel {
  mode(): Mode;
  /** Grid squares across (and down) in test-grid mode. */
  cells(): number;
  /** Width of the grid seen from the front, in the current units (NaN when empty). */
  gridWidth(): number;
  /** Convert the grid width when the measurement units change. */
  setUnits(units: Units): void;
  /** Put back a saved mode and grid size (width in the current units). Doesn't call `onChange`. */
  restore(saved: { mode?: Mode; cells?: number; gridWidth?: number | null }): void;
}

/**
 * Pumpkin vs. test-grid mode. Test-grid mode models a ball from its circumference alone and replaces the
 * uploaded design with a square grid, so the printed template can be checked on a ball of known size.
 * Toggles `ball-mode` on `scope` so the pumpkin-only inputs (and the slits: a grid leaves no blank paper) hide.
 */
export function mountModePanel(root: HTMLElement, scope: HTMLElement, onChange: () => void): ModePanel {
  root.innerHTML = `
    <form class="mode" novalidate>
      <fieldset class="units">
        <legend>What are you making?</legend>
        <label><input type="radio" name="mode" value="pumpkin" checked /> pumpkin template</label>
        <label><input type="radio" name="mode" value="test-grid" /> test grid for a ball</label>
      </fieldset>
      <div class="field ball-only">
        <label for="g-cells">Grid squares across</label>
        <div class="input-row">
          <input id="g-cells" type="number" inputmode="numeric" min="1" max="20" step="1" value="${DEFAULT_CELLS}" />
        </div>
      </div>
      <div class="field ball-only">
        <label for="g-width">Grid width seen from the front</label>
        <div class="input-row">
          <input id="g-width" type="number" inputmode="decimal" min="0" step="any" />
          <span class="unit-label">in</span>
        </div>
        <small class="hint">Enter the ball's circumference below (a basketball is about 29.5 in).
          Print, tape the grid to the ball and check from the front that the squares look square and even.</small>
      </div>
    </form>
  `;
  const form = root.querySelector("form")!;
  const cellsInput = form.querySelector<HTMLInputElement>("#g-cells")!;
  const widthInput = form.querySelector<HTMLInputElement>("#g-width")!;
  const lengths = lengthFields(form, [widthInput]);
  lengths.set(widthInput, DEFAULT_GRID_WIDTH_IN);
  const mode = (): Mode => form.querySelector<HTMLInputElement>('input[name="mode"]:checked')!.value as Mode;
  const sync = () => scope.classList.toggle("ball-mode", mode() === "test-grid");
  sync();

  form.addEventListener("input", () => {
    sync();
    onChange();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    mode,
    restore(saved) {
      if (saved.mode) form.querySelector<HTMLInputElement>(`input[name="mode"][value="${saved.mode}"]`)!.checked = true;
      if (saved.cells !== undefined) cellsInput.value = String(saved.cells);
      if (saved.gridWidth !== undefined) lengths.set(widthInput, saved.gridWidth);
      sync();
    },
    gridWidth: () => lengths.value(widthInput),
    setUnits: (units: Units) => lengths.setUnits(units),
    cells: () => {
      const n = Math.round(Number(cellsInput.value));
      return n >= 1 ? Math.min(n, 20) : DEFAULT_CELLS;
    },
  };
}
