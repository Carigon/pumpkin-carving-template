export type Mode = "pumpkin" | "test-grid";

const DEFAULT_CELLS = 6;

export interface ModePanel {
  mode(): Mode;
  /** Grid squares across (and down) in test-grid mode. */
  cells(): number;
}

/**
 * Pumpkin vs. test-grid mode. Test-grid mode models a ball from its circumference alone and replaces the
 * uploaded design with a square grid, so the printed template can be checked on a ball of known size.
 * Toggles `ball-mode` on `scope` so the pumpkin-only inputs hide.
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
        <small class="hint">Enter the ball's circumference below (a basketball is about 29.5 in).
          Print, tape the grid to the ball and check from the front that the squares look square and even.</small>
      </div>
    </form>
  `;
  const form = root.querySelector("form")!;
  const cellsInput = form.querySelector<HTMLInputElement>("#g-cells")!;
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
    cells: () => {
      const n = Math.round(Number(cellsInput.value));
      return n >= 1 ? Math.min(n, 20) : DEFAULT_CELLS;
    },
  };
}
