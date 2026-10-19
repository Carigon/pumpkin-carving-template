import type { MeasurementField, PumpkinMeasurements, TemplateWarning, Units } from "../core";
import { lengthFields } from "./lengthFields";

const DEFAULTS_IN = { circumference: 30, frontArc: 15 };

const FIELDS: { field: MeasurementField; label: string; hint: string; optional?: boolean }[] = [
  { field: "circumference", label: "Widest circumference", hint: "Tape around the fattest part." },
  { field: "frontArc", label: "Front arc, stem to base", hint: "Tape over the front, from stem to base." },
  { field: "depth", label: "Depth (optional)", hint: "Front to back, for oval pumpkins.", optional: true },
];

export interface MeasurementForm {
  /** Current measurements. Empty required fields read as NaN so the builder reports them. */
  read(): PumpkinMeasurements;
  /** Show impossible-measurement warnings next to the matching inputs; clears the others. */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Put back saved units and values (null = empty). Missing values keep the current ones. Doesn't call `onChange`. */
  restore(saved: { units?: Units; values?: Partial<Record<MeasurementField, number | null>> }): void;
}

/**
 * Measurement form: circumference, front arc, optional depth, with an inch/cm switch.
 * Calls `onChange` with the current measurements on every edit.
 */
export function mountMeasurementForm(
  root: HTMLElement,
  onChange: (m: PumpkinMeasurements) => void,
): MeasurementForm {
  root.innerHTML = `
    <form class="measurements" novalidate>
      <fieldset class="units">
        <legend>Units</legend>
        <label><input type="radio" name="units" value="in" checked /> inches</label>
        <label><input type="radio" name="units" value="cm" /> centimeters</label>
      </fieldset>
      ${FIELDS.map(
        ({ field, label, hint }) => `
        <div class="field" data-field="${field}">
          <label for="m-${field}">${label}</label>
          <div class="input-row">
            <input id="m-${field}" name="${field}" type="number" inputmode="decimal" min="0" step="any"
              aria-describedby="m-${field}-hint m-${field}-warning" />
            <span class="unit-label">in</span>
          </div>
          <small id="m-${field}-hint" class="hint">${hint}</small>
          <div id="m-${field}-warning" class="warning" role="alert" hidden></div>
        </div>`,
      ).join("")}
    </form>
  `;

  const form = root.querySelector("form")!;
  const input = (f: MeasurementField) => form.querySelector<HTMLInputElement>(`#m-${f}`)!;
  const units = (): Units => (form.querySelector<HTMLInputElement>('input[name="units"]:checked')!.value as Units);

  const lengths = lengthFields(form, FIELDS.map(({ field }) => input(field)));
  lengths.set(input("circumference"), DEFAULTS_IN.circumference);
  lengths.set(input("frontArc"), DEFAULTS_IN.frontArc);

  const read = (): PumpkinMeasurements => ({
    circumference: lengths.value(input("circumference")),
    frontArc: lengths.value(input("frontArc")),
    depth: input("depth").value.trim() === "" ? undefined : lengths.value(input("depth")),
    units: lengths.units(),
  });

  form.addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).name !== "units") return;
    lengths.setUnits(units());
    onChange(read());
  });
  form.addEventListener("input", () => onChange(read()));
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    read,
    restore({ units: savedUnits, values = {} }) {
      if (savedUnits) {
        form.querySelector<HTMLInputElement>(`input[name="units"][value="${savedUnits}"]`)!.checked = true;
        lengths.setUnits(savedUnits);
      }
      for (const { field } of FIELDS) {
        const v = values[field];
        if (v !== undefined) lengths.set(input(field), v);
      }
    },
    showWarnings(warnings) {
      for (const { field } of FIELDS) {
        const warningEl = form.querySelector<HTMLElement>(`#m-${field}-warning`)!;
        const messages = warnings
          .filter((w) => w.kind === "impossible-measurement" && w.field === field)
          .map((w) => w.message);
        warningEl.textContent = messages.join(" ");
        warningEl.hidden = messages.length === 0;
        input(field).setAttribute("aria-invalid", String(messages.length > 0));
      }
    },
  };
}
