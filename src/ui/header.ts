import type { Units } from "../core";
import type { Mode } from "../steps";

export interface Header {
  mode(): Mode;
  units(): Units;
  /** Put back a saved mode and units. Doesn't call the change callbacks. */
  restore(saved: { mode?: Mode; units?: Units }): void;
}

/**
 * The slim app header: the title and the app-wide choices, what's being made (pumpkin template or test grid
 * for a ball) and the display units. Calls `onMode` / `onUnits` when one changes.
 */
export function mountHeader(root: HTMLElement, onMode: () => void, onUnits: () => void): Header {
  root.classList.add("app-header");
  root.innerHTML = `
    <h1>Pumpkin carving template</h1>
    <form class="app-choices" novalidate>
      <fieldset class="choice">
        <legend>Making</legend>
        <label><input type="radio" name="mode" value="pumpkin" checked /> pumpkin template</label>
        <label><input type="radio" name="mode" value="test-grid" /> test grid for a ball</label>
      </fieldset>
      <fieldset class="choice">
        <legend>Units</legend>
        <label><input type="radio" name="units" value="in" checked /> in</label>
        <label><input type="radio" name="units" value="cm" /> cm</label>
      </fieldset>
    </form>
  `;
  const form = root.querySelector("form")!;
  const checked = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;
  const check = (name: string, value: string) => {
    form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.checked = true;
  };

  form.addEventListener("change", (e) => {
    const name = (e.target as HTMLInputElement).name;
    if (name === "mode") onMode();
    else if (name === "units") onUnits();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    mode: () => checked("mode") as Mode,
    units: () => checked("units") as Units,
    restore(saved) {
      if (saved.mode) check("mode", saved.mode);
      if (saved.units) check("units", saved.units);
    },
  };
}
