import type { Units } from "../core";
import type { Mode } from "../steps";

export interface Header {
  mode(): Mode;
  units(): Units;
  /** Whether deleting a ring with its × asks first (the settings menu's checkbox). */
  askBeforeDeletingRing(): boolean;
  /** Tick or untick "Ask before deleting a ring" (e.g. the confirmation's "Don't ask again"). Doesn't call `onPrefs`. */
  setAskBeforeDeletingRing(ask: boolean): void;
  /** Put back a saved mode, units and preferences. Doesn't call the change callbacks. */
  restore(saved: { mode?: Mode; units?: Units; askBeforeDeletingRing?: boolean }): void;
}

/**
 * The slim app header: the title and the app-wide choices, what's being made (pumpkin template or test grid
 * for a ball) and the display units, and a settings button opening a menu of app-wide preferences. Calls
 * `onMode` / `onUnits` when one changes, and `onPrefs` when a preference in the menu does.
 */
export function mountHeader(root: HTMLElement, onMode: () => void, onUnits: () => void, onPrefs: () => void): Header {
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
    <div class="app-settings">
      <button type="button" class="settings-button" aria-expanded="false" aria-controls="app-settings-menu"
        title="Settings">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z M19.4 13.5l1.8 1.4-1.8 3.1-2.2-.8a7.6 7.6 0 0 1-2 1.1l-.3 2.3h-3.6l-.3-2.3a7.6 7.6 0 0 1-2-1.1l-2.2.8-1.8-3.1 1.8-1.4a7.7 7.7 0 0 1 0-2.6L3 9.5l1.8-3.1 2.2.8a7.6 7.6 0 0 1 2-1.1l.3-2.3h3.6l.3 2.3a7.6 7.6 0 0 1 2 1.1l2.2-.8 1.8 3.1-1.8 1.4a7.7 7.7 0 0 1 0 2.6Z" />
        </svg>
        <span class="visually-hidden">Settings</span>
      </button>
      <div id="app-settings-menu" class="settings-menu" hidden>
        <label><input type="checkbox" name="ask-before-deleting-ring" checked /> Ask before deleting a ring</label>
      </div>
    </div>
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

  // The settings menu: a disclosure (the button's aria-expanded), closed by Escape or a click outside.
  const settings = root.querySelector<HTMLElement>(".app-settings")!;
  const button = settings.querySelector<HTMLButtonElement>(".settings-button")!;
  const menu = settings.querySelector<HTMLElement>(".settings-menu")!;
  const askInput = menu.querySelector<HTMLInputElement>('input[name="ask-before-deleting-ring"]')!;
  const open = (next: boolean) => {
    menu.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
  };
  button.addEventListener("click", () => open(menu.hidden));
  settings.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || menu.hidden) return;
    e.preventDefault();
    open(false);
    button.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !settings.contains(e.target as Node)) open(false);
  });
  // Tabbing out of the menu closes it too.
  settings.addEventListener("focusout", (e) => {
    if (!menu.hidden && e.relatedTarget instanceof Node && !settings.contains(e.relatedTarget)) open(false);
  });
  askInput.addEventListener("change", onPrefs);

  return {
    mode: () => checked("mode") as Mode,
    units: () => checked("units") as Units,
    askBeforeDeletingRing: () => askInput.checked,
    setAskBeforeDeletingRing(ask) {
      askInput.checked = ask;
    },
    restore(saved) {
      if (saved.mode) check("mode", saved.mode);
      if (saved.units) check("units", saved.units);
      if (saved.askBeforeDeletingRing !== undefined) askInput.checked = saved.askBeforeDeletingRing;
    },
  };
}
