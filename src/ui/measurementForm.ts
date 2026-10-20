import { nextRing, type PumpkinMeasurements, type TemplateWarning, type Units } from "../core";
import { lengthFields } from "./lengthFields";

/** In mm. */
const DEFAULTS_MM = { height: 230, circumference: 760 };

/** Saved values to put back; null = an empty field. Ring positions are fractions of the height. */
export interface SavedMeasurements {
  /** In mm. */
  height?: number | null;
  rings?: { position: number | null; circumference: number | null }[];
}

export interface MeasurementForm {
  /**
   * Current measurements, in mm. Empty fields read as NaN so the builder reports them; ring rows left completely
   * empty are skipped.
   */
  read(): PumpkinMeasurements;
  /** Show impossible-measurement warnings next to the height and the matching rings; clears the others. */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Show every length (height and rings) in `units` display units. Doesn't call `onChange`. */
  setUnits(units: Units): void;
  /** Put back saved values. Missing values keep the current ones. Doesn't call `onChange`. */
  restore(saved: SavedMeasurements): void;
}

interface RingRow {
  el: HTMLElement;
  name: HTMLElement;
  /** Height above the table. */
  above: HTMLInputElement;
  circumference: HTMLInputElement;
  /** Shows `position` as a hint. */
  positionHint: HTMLElement;
  warning: HTMLElement;
  /** The ring's place as a fraction of the height (0 = table, 1 = top); NaN until it is known. */
  position: number;
}

/**
 * Measurement form: the height, and tape rings each at a height above the table. The display units are chosen in
 * the header and set with `setUnits`.
 * Ring heights are kept as fractions of the height, so changing the height keeps the rings in proportion.
 * Calls `onChange` with the current measurements on every edit.
 */
export function mountMeasurementForm(root: HTMLElement, onChange: (m: PumpkinMeasurements) => void): MeasurementForm {
  root.innerHTML = `
    <form class="measurements card" novalidate>
      <h2>Measurements</h2>
      <div class="field" data-field="height">
        <label for="m-height">Height</label>
        <div class="input-row">
          <input id="m-height" name="height" type="number" inputmode="decimal" min="0" step="any"
            aria-describedby="m-height-hint m-height-warning" />
          <span class="unit-label">in</span>
        </div>
        <div id="m-height-hint" class="hint">From the table to a book laid flat on top, stem left out.
          <details class="more"><summary>more</summary>Lay the book across the pumpkin's shoulders so it rests
            level, then measure straight up from the table to the book's underside. The stem doesn't count.</details>
        </div>
        <div id="m-height-warning" class="warning" role="alert" hidden></div>
      </div>
      <fieldset class="rings field" data-field="rings">
        <legend><span class="pumpkin-only">Rings around the pumpkin</span><span class="ball-only">Ball</span></legend>
        <div class="hint pumpkin-only">Wrap the tape level around the widest part and note its height.
          <details class="more"><summary>more</summary>Keep the tape level all the way round and measure how high
            above the table it sits. Start with the widest part. For tall, squat, lopsided or barrel-shaped
            pumpkins, add more rings higher and lower: each one makes the model follow the pumpkin more
            closely.</details>
        </div>
        <div class="hint ball-only">The ball's circumference.</div>
        <ol class="ring-list"></ol>
        <div class="warning rings-warning" role="alert" hidden></div>
        <button type="button" class="add-ring">+ Add ring</button>
      </fieldset>
    </form>
  `;

  const form = root.querySelector("form")!;
  const heightInput = form.querySelector<HTMLInputElement>("#m-height")!;
  const list = form.querySelector<HTMLOListElement>(".ring-list")!;
  const ringsWarning = form.querySelector<HTMLElement>(".rings-warning")!;

  const lengths = lengthFields(form, [heightInput]);
  lengths.set(heightInput, DEFAULTS_MM.height);
  const height = () => lengths.value(heightInput);
  const heightOk = () => Number.isFinite(height()) && height() > 0;

  const rows: RingRow[] = [];
  /** The row behind each ring of the last `read()`, so ring warnings land on the right row. */
  let readRows: RingRow[] = [];
  let nextId = 0;

  /** Name the widest ring and show where each ring is, as a fraction of the height. */
  const refresh = () => {
    const circumferences = rows.map((r) => lengths.value(r.circumference));
    const widest = Math.max(...circumferences.filter(Number.isFinite));
    rows.forEach((row, i) => {
      row.name.textContent = circumferences[i] === widest && circumferences.indexOf(widest) === i ? "Widest circumference" : "Ring";
      row.positionHint.textContent = Number.isFinite(row.position) ? `${Math.round(row.position * 1000) / 1000} of the height` : "";
    });
  };

  const addRow = (position: number, circumference: number | null): RingRow => {
    const id = nextId++;
    const el = document.createElement("li");
    el.className = "ring";
    el.innerHTML = `
      <div class="ring-head">
        <span class="ring-name"></span>
        <button type="button" class="remove-ring" aria-label="Remove this ring">×</button>
      </div>
      <div class="ring-fields">
        <div class="field ring-at">
          <label for="r-${id}-h">Above the table</label>
          <div class="input-row">
            <input id="r-${id}-h" type="number" inputmode="decimal" min="0" step="any" />
            <span class="unit-label">${lengths.units()}</span>
          </div>
        </div>
        <div class="field">
          <label for="r-${id}-c">Around</label>
          <div class="input-row">
            <input id="r-${id}-c" type="number" inputmode="decimal" min="0" step="any" />
            <span class="unit-label">${lengths.units()}</span>
          </div>
        </div>
      </div>
      <div class="hint ring-fraction" id="r-${id}-fraction"></div>
      <div class="warning" id="r-${id}-warning" role="alert" hidden></div>
    `;
    const row: RingRow = {
      el,
      name: el.querySelector<HTMLElement>(".ring-name")!,
      above: el.querySelector<HTMLInputElement>(`#r-${id}-h`)!,
      circumference: el.querySelector<HTMLInputElement>(`#r-${id}-c`)!,
      positionHint: el.querySelector<HTMLElement>(".ring-fraction")!,
      warning: el.querySelector<HTMLElement>(".warning")!,
      position,
    };
    row.above.setAttribute("aria-describedby", `r-${id}-fraction r-${id}-warning`);
    row.circumference.setAttribute("aria-describedby", `r-${id}-warning`);
    for (const i of [row.above, row.circumference]) lengths.add(i);
    lengths.set(row.above, Number.isFinite(position) && heightOk() ? position * height() : null);
    lengths.set(row.circumference, circumference);
    el.querySelector(".remove-ring")!.addEventListener("click", () => {
      lengths.remove(row.above);
      lengths.remove(row.circumference);
      rows.splice(rows.indexOf(row), 1);
      el.remove();
      refresh();
      onChange(read());
    });
    rows.push(row);
    list.append(el);
    return row;
  };
  const clearRows = () => {
    for (const row of [...rows]) {
      lengths.remove(row.above);
      lengths.remove(row.circumference);
      row.el.remove();
    }
    rows.length = 0;
  };

  /** After the height changes: rings keep their positions, and rings typed before the height get one. */
  const followHeight = () => {
    if (!heightOk()) return;
    for (const row of rows) {
      if (Number.isFinite(row.position)) lengths.set(row.above, row.position * height());
      else if (Number.isFinite(lengths.value(row.above))) row.position = lengths.value(row.above) / height();
    }
  };

  const read = (): PumpkinMeasurements => {
    const filled = rows.filter((r) => r.above.value.trim() !== "" || r.circumference.value.trim() !== "");
    readRows = filled;
    return {
      height: height(),
      rings: filled.map((r) => ({
        position: r.above.value.trim() === "" ? Number.NaN : r.position,
        circumference: lengths.value(r.circumference),
      })),
    };
  };

  addRow(0.5, DEFAULTS_MM.circumference);
  refresh();

  form.querySelector(".add-ring")!.addEventListener("click", () => {
    const ring = nextRing(read());
    // Exact, so the shape doesn't change until the carver types a measurement (the field shows it rounded).
    addRow(ring.position, Number.isFinite(ring.circumference) ? ring.circumference : null).circumference.focus();
    refresh();
    onChange(read());
  });
  form.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    if (target === heightInput) followHeight();
    const row = rows.find((r) => r.above === target);
    if (row) row.position = heightOk() ? lengths.value(row.above) / height() : Number.NaN;
    refresh();
    onChange(read());
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    read,
    setUnits: (next) => lengths.setUnits(next),
    restore({ height: savedHeight, rings }) {
      if (savedHeight !== undefined) {
        lengths.set(heightInput, savedHeight);
        followHeight();
      }
      if (rings) {
        clearRows();
        for (const r of rings) addRow(r.position ?? Number.NaN, r.circumference);
      }
      refresh();
    },
    showWarnings(warnings) {
      const measurement = warnings.filter((w) => w.kind === "impossible-measurement");
      const show = (el: HTMLElement, messages: string[]) => {
        el.textContent = messages.join(" ");
        el.hidden = messages.length === 0;
      };
      const heightMessages = measurement.filter((w) => w.field === "height").map((w) => w.message);
      show(form.querySelector<HTMLElement>("#m-height-warning")!, heightMessages);
      heightInput.setAttribute("aria-invalid", String(heightMessages.length > 0));
      show(ringsWarning, measurement.filter((w) => w.field === "ring" && w.ring === undefined).map((w) => w.message));
      for (const row of rows) {
        const i = readRows.indexOf(row);
        const messages = measurement.filter((w) => w.field === "ring" && i >= 0 && w.ring === i).map((w) => w.message);
        show(row.warning, messages);
        for (const el of [row.above, row.circumference]) el.setAttribute("aria-invalid", String(messages.length > 0));
      }
    },
  };
}
