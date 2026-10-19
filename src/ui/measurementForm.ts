import type { MeasurementField, PumpkinMeasurements, Ring, TemplateWarning, Units } from "../core";
import { lengthFields } from "./lengthFields";

const DEFAULTS_IN = { circumference: 30, frontArc: 15 };

/** The single-value fields (rings are a list of their own). */
type SingleField = Exclude<MeasurementField, "ring">;

const FIELDS: { field: SingleField; label: string; hint: string; optional?: boolean }[] = [
  { field: "circumference", label: "Widest circumference", hint: "Tape around the fattest part." },
  {
    field: "circumferenceAt",
    label: "Where it's widest (optional)",
    hint: "Distance from the stem, along the front, to where you wrapped the tape. Leave empty if unsure.",
    optional: true,
  },
  { field: "frontArc", label: "Front arc, stem to base", hint: "Tape over the front, from stem to base." },
  {
    field: "depth",
    label: "Depth (optional)",
    hint:
      "For oval pumpkins: the straight-line distance from front to back through the pumpkin. Press two books or " +
      "boxes against the front and back, keep them parallel, and measure the gap between them.",
    optional: true,
  },
];

/** Saved values to put back; null = an empty field. */
export interface SavedMeasurements {
  units?: Units;
  values?: Partial<Record<SingleField, number | null>>;
  rings?: { distance: number | null; circumference: number | null }[];
}

export interface MeasurementForm {
  /**
   * Current measurements. Empty required fields read as NaN so the builder reports them; ring rows left
   * completely empty are skipped.
   */
  read(): PumpkinMeasurements;
  /** Show impossible-measurement warnings next to the matching inputs and rings; clears the others. */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Put back saved units and values. Missing values keep the current ones. Doesn't call `onChange`. */
  restore(saved: SavedMeasurements): void;
}

interface RingRow {
  el: HTMLElement;
  distance: HTMLInputElement;
  circumference: HTMLInputElement;
  warning: HTMLElement;
}

/**
 * Measurement form: widest circumference (and optionally where it was taken), front arc, optional depth,
 * extra rings, with an inch/cm switch. Calls `onChange` with the current measurements on every edit.
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
      <fieldset class="rings field" data-field="rings">
        <legend>Extra rings (optional)</legend>
        <small class="hint">For tall, squat, lopsided or barrel-shaped pumpkins. Put small tape marks down the
          front at chosen distances from the stem (say a quarter, half and three quarters of the way), wrap the
          tape around the pumpkin level at each mark, and enter each mark's distance and circumference.</small>
        <ol class="ring-list"></ol>
        <button type="button" class="add-ring">+ add ring</button>
      </fieldset>
    </form>
  `;

  const form = root.querySelector("form")!;
  const input = (f: SingleField) => form.querySelector<HTMLInputElement>(`#m-${f}`)!;
  const units = (): Units => (form.querySelector<HTMLInputElement>('input[name="units"]:checked')!.value as Units);
  const list = form.querySelector<HTMLOListElement>(".ring-list")!;

  const lengths = lengthFields(form, FIELDS.map(({ field }) => input(field)));
  lengths.set(input("circumference"), DEFAULTS_IN.circumference);
  lengths.set(input("frontArc"), DEFAULTS_IN.frontArc);

  const rows: RingRow[] = [];
  /** The row behind each ring of the last `read()`, so ring warnings land on the right row. */
  let readRows: RingRow[] = [];
  let nextId = 0;

  const addRow = (distance: number | null = null, circumference: number | null = null): RingRow => {
    const id = nextId++;
    const el = document.createElement("li");
    el.className = "ring";
    el.innerHTML = `
      <div class="input-row">
        <label for="r-${id}-d">From stem (along the arc)</label>
        <input id="r-${id}-d" type="number" inputmode="decimal" min="0" step="any" />
        <span class="unit-label">${lengths.units()}</span>
        <label for="r-${id}-c">around</label>
        <input id="r-${id}-c" type="number" inputmode="decimal" min="0" step="any" />
        <span class="unit-label">${lengths.units()}</span>
        <button type="button" class="remove-ring" aria-label="Remove this ring">×</button>
      </div>
      <div class="warning" role="alert" hidden></div>
    `;
    const row: RingRow = {
      el,
      distance: el.querySelector<HTMLInputElement>(`#r-${id}-d`)!,
      circumference: el.querySelector<HTMLInputElement>(`#r-${id}-c`)!,
      warning: el.querySelector<HTMLElement>(".warning")!,
    };
    for (const i of [row.distance, row.circumference]) {
      lengths.add(i);
      i.setAttribute("aria-describedby", row.warning.id = `r-${id}-warning`);
    }
    lengths.set(row.distance, distance);
    lengths.set(row.circumference, circumference);
    el.querySelector(".remove-ring")!.addEventListener("click", () => {
      lengths.remove(row.distance);
      lengths.remove(row.circumference);
      rows.splice(rows.indexOf(row), 1);
      el.remove();
      onChange(read());
    });
    rows.push(row);
    list.append(el);
    return row;
  };
  const clearRows = () => {
    for (const row of [...rows]) {
      lengths.remove(row.distance);
      lengths.remove(row.circumference);
      row.el.remove();
    }
    rows.length = 0;
  };

  const optional = (f: SingleField) => (input(f).value.trim() === "" ? undefined : lengths.value(input(f)));
  const read = (): PumpkinMeasurements => {
    const filled = rows.filter((r) => r.distance.value.trim() !== "" || r.circumference.value.trim() !== "");
    readRows = filled;
    const rings: Ring[] = filled.map((r) => ({ distance: lengths.value(r.distance), circumference: lengths.value(r.circumference) }));
    return {
      circumference: lengths.value(input("circumference")),
      frontArc: lengths.value(input("frontArc")),
      depth: optional("depth"),
      circumferenceAt: optional("circumferenceAt"),
      ...(rings.length > 0 ? { rings } : {}),
      units: lengths.units(),
    };
  };

  form.querySelector(".add-ring")!.addEventListener("click", () => {
    addRow().distance.focus();
    onChange(read());
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
    restore({ units: savedUnits, values = {}, rings }) {
      if (savedUnits) {
        form.querySelector<HTMLInputElement>(`input[name="units"][value="${savedUnits}"]`)!.checked = true;
        lengths.setUnits(savedUnits);
      }
      for (const { field } of FIELDS) {
        const v = values[field];
        if (v !== undefined) lengths.set(input(field), v);
      }
      if (rings) {
        clearRows();
        for (const r of rings) addRow(r.distance, r.circumference);
      }
    },
    showWarnings(warnings) {
      const measurement = warnings.filter((w) => w.kind === "impossible-measurement");
      for (const { field } of FIELDS) {
        const warningEl = form.querySelector<HTMLElement>(`#m-${field}-warning`)!;
        const messages = measurement.filter((w) => w.field === field).map((w) => w.message);
        warningEl.textContent = messages.join(" ");
        warningEl.hidden = messages.length === 0;
        input(field).setAttribute("aria-invalid", String(messages.length > 0));
      }
      for (const row of rows) {
        const i = readRows.indexOf(row);
        const messages = measurement.filter((w) => w.field === "ring" && i >= 0 && w.ring === i).map((w) => w.message);
        row.warning.textContent = messages.join(" ");
        row.warning.hidden = messages.length === 0;
        for (const el of [row.distance, row.circumference]) el.setAttribute("aria-invalid", String(messages.length > 0));
      }
    },
  };
}
