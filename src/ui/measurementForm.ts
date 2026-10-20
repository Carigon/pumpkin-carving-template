import type { TemplateWarning, Units } from "../core";
import { tapeLength } from "../displayUnits";
import {
  deleteRing,
  insertRing,
  sortRings,
  typeCircumference,
  typeHeight,
  typeRingHeight,
  type ClampNote,
  type Gap,
  type RingId,
  type RingMeasurements,
} from "../ringEdits";
import { placeMeasureWarnings } from "../measureWarnings";
import type { ConfirmDelete } from "./deleteConfirm";
import { lengthFields } from "./lengthFields";

/** How long a re-sorted row takes to slide to its place, ms. */
const SLIDE_MS = 200;

export interface MeasurementForm {
  /**
   * Show the shared measurements: the height, and one row per ring in the measurements' order, matched to the
   * rows by ring id (rows are added and removed to follow). Doesn't call `onChange`.
   */
  show(measurements: RingMeasurements): void;
  /**
   * Show impossible-measurement warnings next to the height and the matching rings; clears the others. A failed
   * fit marks the row of `edited`, the ring edited last, or no row (it goes under the table) when that's null.
   */
  showWarnings(warnings: TemplateWarning[], edited: RingId | null): void;
  /**
   * Show the shared selection (its row gets an accent bar and a tint) and hover (a ring's row or a gap's insert
   * button). `scroll`: the selection came from the view, so its row scrolls into view if need be. Never moves focus.
   */
  showLinks(selected: RingId | "height" | null, hovered: RingId | Gap | null, scroll: boolean): void;
  /** Show every length (height and rings) in `units` display units. Doesn't call `onChange`. */
  setUnits(units: Units): void;
  /** Test-grid mode: the first ring alone is the ball, one Around/Across pair held only by the ring size limits. */
  setBall(ball: boolean): void;
}

/**
 * A ring's row: its height above the table, its circumference (Around, the stored value) and its diameter (Across,
 * derived), a × to remove it, and its note and warning lines underneath.
 */
interface RingRow {
  id: RingId;
  el: HTMLElement;
  above: HTMLInputElement;
  around: HTMLInputElement;
  across: HTMLInputElement;
  remove: HTMLButtonElement;
  widest: HTMLElement;
  /** The row's name for screen readers ("ring 2 of 3"), read after each column header. */
  name: HTMLElement;
  note: HTMLElement;
  warning: HTMLElement;
}

/** An insert button's band in a gap between rows (or above the top row or below the bottom one). */
interface GapRow {
  gap: Gap;
  el: HTMLElement;
  button: HTMLButtonElement;
}

/** How the form tells the Blueprint view what the carver is pointing at, and asks before deleting. */
export interface FormLinks {
  /** A field in a ring's row (or the Height) got focus: select that ring (or the height line). */
  select(selected: RingId | "height"): void;
  /** The pointer is over a ring's row, an insert button (its gap) or neither. */
  hover(hovered: RingId | Gap | null): void;
  /** Asks before a row's × deletes its ring (unless asking is turned off); shared with the view. */
  confirmDelete: ConfirmDelete;
}

/** Which field of a row an input is. */
type Column = "above" | "around" | "across";

/**
 * Measurement form: the Height field, then a table with one line per ring, sorted top to bottom like the
 * Blueprint view: its height above the table, its circumference (Around) and its diameter (Across). It renders
 * from the shared measurements (`show`) and every edit goes through the ring-edit rules: keystrokes reach
 * `onChange` as they're typed, and on commit (blur or Enter) the value is clamped, with a note when it is, and the
 * rows re-sort. Insert buttons in every gap add a ring there; a row's × removes it, asking first.
 * `onChange` gets the new measurements and the ring edited (typed in or added; null for the height or a removed
 * ring). Focusing a row's field selects its ring in the view, and hovering a row or an insert button points at
 * its ring or gap there (`links`); the view's selection and hover show here (`showLinks`).
 */
export function mountMeasurementForm(
  root: HTMLElement,
  onChange: (m: RingMeasurements, edited: RingId | null) => void,
  links: FormLinks,
): MeasurementForm {
  root.innerHTML = `
    <form class="measurements card" novalidate>
      <h2>Measurements</h2>
      <div class="field height-row" data-field="height">
        <label for="m-height">Height</label>
        <div class="input-row">
          <input id="m-height" name="height" type="number" inputmode="decimal" min="0" step="any"
            aria-describedby="m-height-hint m-height-note m-height-warning" />
          <span class="unit-label">in</span>
        </div>
        <div id="m-height-hint" class="hint">From the table to a book laid flat on top, stem left out.
          <details class="more"><summary>more</summary>Lay the book across the pumpkin's shoulders so it rests
            level, then measure straight up from the table to the book's underside. The stem doesn't count.</details>
        </div>
        <div id="m-height-note" class="clamp-note" role="status" hidden></div>
        <div id="m-height-warning" class="warning" role="alert" hidden></div>
      </div>
      <fieldset class="rings field" data-field="rings">
        <legend><span class="pumpkin-only">Rings around the pumpkin</span><span class="ball-only">Ball</span></legend>
        <div class="hint pumpkin-only">Wrap the tape level around the widest part and note its height.
          <details class="more"><summary>more</summary>Keep the tape level all the way round and measure how high
            above the table it sits. Start with the widest part. For tall, squat, lopsided or barrel-shaped
            pumpkins, add more rings higher and lower with the + between the rows: each one makes the model follow
            the pumpkin more closely.</details>
        </div>
        <div class="hint ball-only">The ball's circumference, or its diameter.</div>
        <div class="ring-table">
          <div class="ring-cols">
            <span id="rc-above" class="ring-at">Above the table (<span class="unit-label">in</span>)</span>
            <span id="rc-around">Around (<span class="unit-label">in</span>)</span>
            <span id="rc-across">Across (<span class="unit-label">in</span>)</span>
          </div>
        </div>
        <div class="clamp-note rings-note" role="status" hidden></div>
        <div class="warning rings-warning" role="alert" hidden></div>
      </fieldset>
    </form>
  `;

  const form = root.querySelector("form")!;
  const heightInput = form.querySelector<HTMLInputElement>("#m-height")!;
  const table = form.querySelector<HTMLElement>(".ring-table")!;
  const heightRow = form.querySelector<HTMLElement>(".height-row")!;
  const heightNote = form.querySelector<HTMLElement>("#m-height-note")!;
  const ringsNote = form.querySelector<HTMLElement>(".rings-note")!;
  const ringsWarning = form.querySelector<HTMLElement>(".rings-warning")!;

  const lengths = lengthFields(form, [heightInput]);
  /** The measurements shown, in the order the rows are in. */
  let current: RingMeasurements = { height: Number.NaN, rings: [] };
  /** The measurements when the field being typed in got focus: a typed height is held from where it was then. */
  let base: RingMeasurements = current;
  let ball = false;
  const rows = new Map<RingId, RingRow>();
  /** Insert buttons by the gap they fill, `above:below`, so a focused one survives a redraw. */
  const gaps = new Map<string, GapRow>();
  /** Inputs typed in since their last commit: only they commit on blur or Enter. */
  const dirty = new Set<HTMLInputElement>();
  /** The note from the last edit, on a ring's row, under the height or under the table ("rings"). */
  let note: { on: RingId | "height" | "rings"; message: string } | null = null;
  /** The shared selection and hover, as last shown. */
  let selected: RingId | "height" | null = null;
  let hovered: RingId | Gap | null = null;

  const height = () => current.height;
  const heightOk = () => Number.isFinite(height()) && height() > 0;
  /** A ring's height above the table as a tape would read it, or "?" before it's known. */
  const at = (id: RingId) => {
    const ring = current.rings.find((r) => r.id === id);
    return ring && heightOk() && Number.isFinite(ring.position) ? tapeLength(ring.position * height(), lengths.units()) : "?";
  };

  const addRow = (id: RingId): RingRow => {
    const el = document.createElement("div");
    el.className = "ring";
    el.dataset.ring = String(id);
    const input = (column: Column, header: string, cls = "") =>
      `<input id="r-${id}-${column}" class="${cls}" type="number" inputmode="decimal" min="0" step="any"
        aria-labelledby="${header} r-${id}-name" aria-describedby="r-${id}-note r-${id}-warning" />`;
    el.innerHTML = `
      <div class="ring-line">
        ${input("above", "rc-above", "ring-at")}
        ${input("around", "rc-around")}
        ${input("across", "rc-across")}
        <button type="button" class="remove-ring">×</button>
        <span class="widest-tag" hidden>Widest</span>
      </div>
      <span class="visually-hidden" id="r-${id}-name"></span>
      <div class="clamp-note" id="r-${id}-note" role="status" hidden></div>
      <div class="warning" id="r-${id}-warning" role="alert" hidden></div>
    `;
    const row: RingRow = {
      id,
      el,
      above: el.querySelector<HTMLInputElement>(`#r-${id}-above`)!,
      around: el.querySelector<HTMLInputElement>(`#r-${id}-around`)!,
      across: el.querySelector<HTMLInputElement>(`#r-${id}-across`)!,
      remove: el.querySelector<HTMLButtonElement>(".remove-ring")!,
      widest: el.querySelector<HTMLElement>(".widest-tag")!,
      name: el.querySelector<HTMLElement>(`#r-${id}-name`)!,
      note: el.querySelector<HTMLElement>(".clamp-note")!,
      warning: el.querySelector<HTMLElement>(".warning")!,
    };
    for (const i of [row.above, row.around, row.across]) lengths.add(i);
    row.remove.addEventListener("click", () => {
      void links.confirmDelete(`the ring at ${at(id)}`).then((ok) => {
        if (ok) remove(id);
      });
    });
    rows.set(id, row);
    return row;
  };

  const dropRow = (row: RingRow) => {
    for (const i of [row.above, row.around, row.across]) {
      lengths.remove(i);
      dirty.delete(i);
    }
    row.el.remove();
    rows.delete(row.id);
  };

  const gapRow = (gap: Gap): GapRow => {
    const key = `${gap.above}:${gap.below}`;
    const kept = gaps.get(key);
    if (kept) return kept;
    const el = document.createElement("div");
    el.className = "ring-gap";
    el.innerHTML = `<button type="button" class="insert-ring"><span class="insert-plus" aria-hidden="true">+</span></button>`;
    const made: GapRow = { gap, el, button: el.querySelector("button")! };
    made.button.addEventListener("click", () => insert(made.gap));
    gaps.set(key, made);
    return made;
  };

  /** Fill a row's fields from its ring. A height not yet known leaves what was typed. */
  const fill = (row: RingRow) => {
    const ring = current.rings.find((r) => r.id === row.id)!;
    if (Number.isFinite(ring.position) && heightOk()) lengths.set(row.above, ring.position * height());
    const c = ring.circumference;
    lengths.set(row.around, Number.isFinite(c) ? c : null);
    lengths.set(row.across, Number.isFinite(c) ? c / Math.PI : null);
  };

  /** The Widest tag, each row's name and × label, each insert button's label and the notes. */
  const relabel = () => {
    const n = current.rings.length;
    const circumferences = current.rings.map((r) => r.circumference);
    const widest = circumferences.indexOf(Math.max(...circumferences.filter(Number.isFinite)));
    current.rings.forEach((ring, i) => {
      const row = rows.get(ring.id)!;
      row.widest.hidden = i !== widest;
      row.name.textContent = ball ? "" : `ring ${i + 1} of ${n}${i === widest ? ", widest" : ""}`;
      row.remove.setAttribute("aria-label", `Remove the ring at ${at(ring.id)}`);
      row.remove.hidden = n === 1;
    });
    for (const { gap, button } of gaps.values()) {
      const top = gap.above === null ? "the top" : at(gap.above);
      const bottom = gap.below === null ? "the table" : at(gap.below);
      button.setAttribute("aria-label", `Add a ring between ${top} and ${bottom}`);
    }
    const show = (el: HTMLElement, on: RingId | "height" | "rings") => {
      el.textContent = note?.on === on ? note.message : "";
      el.hidden = note?.on !== on;
    };
    show(heightNote, "height");
    show(ringsNote, "rings");
    for (const row of rows.values()) show(row.note, row.id);
  };

  /**
   * Put the rows (and the insert buttons between them) in the measurements' order, adding and removing rows to
   * match. Focus stays where it was, even in a row that moved. `slide`: a re-sorted ring, whose row slides to
   * its place and flashes.
   */
  const layout = (slide: RingId | null = null) => {
    const before = new Map([...table.children].map((el) => [el, el.getBoundingClientRect().top]));
    if (Number.isFinite(current.height)) lengths.set(heightInput, current.height);
    const ids = new Set(current.rings.map((r) => r.id));
    for (const row of [...rows.values()]) if (!ids.has(row.id)) dropRow(row);
    const order: HTMLElement[] = [table.querySelector<HTMLElement>(".ring-cols")!];
    const wanted = new Set<string>();
    // The ball is the first ring alone: no other rows and no insert buttons.
    const shown = ball ? current.rings.slice(0, 1) : current.rings;
    shown.forEach((ring, i) => {
      if (!ball) {
        const gap = { above: i === 0 ? null : shown[i - 1].id, below: ring.id };
        order.push(gapRow(gap).el);
        wanted.add(`${gap.above}:${gap.below}`);
      }
      const row = rows.get(ring.id) ?? addRow(ring.id);
      fill(row);
      order.push(row.el);
    });
    if (!ball && shown.length > 0) {
      const gap = { above: shown[shown.length - 1].id, below: null };
      order.push(gapRow(gap).el);
      wanted.add(`${gap.above}:${gap.below}`);
    }
    for (const [key, g] of gaps) {
      if (!wanted.has(key)) {
        g.el.remove();
        gaps.delete(key);
      }
    }
    for (const row of rows.values()) if (!shown.some((r) => r.id === row.id)) row.el.remove();

    const focused = document.activeElement;
    order.forEach((el, i) => {
      if (table.children[i] !== el) table.insertBefore(el, table.children[i] ?? null);
    });
    // Moving a focused field can drop its focus.
    if (focused instanceof HTMLElement && focused !== document.activeElement && focused.isConnected) {
      focused.focus({ preventScroll: true });
    }
    relabel();
    mark();
    if (slide === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of order) {
      const top = before.get(el);
      if (top === undefined) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "ease-out" });
    }
    const moved = rows.get(slide)?.el;
    if (moved) {
      moved.classList.remove("flash");
      void moved.offsetWidth;
      moved.classList.add("flash");
    }
  };

  /** Mark the selected row (or the Height) and the hovered row or insert button; nothing on a ball, as in the view. */
  const mark = () => {
    const sel = ball ? null : selected;
    const hov = ball ? null : hovered;
    heightRow.classList.toggle("selected", sel === "height");
    for (const row of rows.values()) {
      row.el.classList.toggle("selected", row.id === sel);
      row.el.classList.toggle("hovered", row.id === hov);
    }
    const gap = hov !== null && typeof hov === "object" ? hov : null;
    for (const g of gaps.values()) {
      g.button.classList.toggle("hovered", gap !== null && g.gap.above === gap.above && g.gap.below === gap.below);
    }
  };

  /**
   * Take an edit's measurements and note, redraw and pass them on. `slide`: a committed ring, whose row slides
   * to its new place if the edit re-sorted the rows.
   */
  const apply = (m: RingMeasurements, edited: RingId | null, next: typeof note, slide: RingId | null = null) => {
    const order = current.rings.map((r) => r.id).join();
    current = m;
    note = next;
    // A commit on blur re-sorts once the browser has moved focus where it was going (e.g. Tab), so focus can
    // be kept wherever it lands.
    if (slide !== null && order !== m.rings.map((r) => r.id).join()) setTimeout(() => layout(slide));
    else layout();
    onChange(current, edited);
  };

  const noteOn = (on: RingId | "height" | "rings", n: ClampNote | null, warning: string | null = null) => {
    const message = n?.message ?? warning;
    return message ? { on, message } : null;
  };

  const insert = (gap: Gap) => {
    const edit = insertRing(current, gap);
    if (edit.id === null) {
      note = noteOn("rings", edit.note);
      relabel();
      return;
    }
    apply(edit.measurements, edit.id, null);
    rows.get(edit.id)?.around.focus();
  };

  const remove = (id: RingId) => {
    const edit = deleteRing(current, id);
    if (edit.measurements.rings.length === current.rings.length) {
      note = noteOn(id, edit.note);
      relabel();
      return;
    }
    // Focus moves to the row that takes its place (or the one above, for the bottom row).
    const i = current.rings.findIndex((r) => r.id === id);
    const rest = edit.measurements.rings;
    const next = rest[Math.min(i, rest.length - 1)];
    apply(edit.measurements, null, null);
    const row = next && rows.get(next.id);
    if (row) (row.remove.hidden ? row.around : row.remove).focus();
  };

  /** Which row and column an input is, if it's a ring's. */
  const ringField = (input: HTMLInputElement): { row: RingRow; column: Column } | null => {
    for (const row of rows.values()) {
      if (input === row.above) return { row, column: "above" };
      if (input === row.around) return { row, column: "around" };
      if (input === row.across) return { row, column: "across" };
    }
    return null;
  };

  const withRing = (id: RingId, patch: { position?: number; circumference?: number }): RingMeasurements => ({
    height: current.height,
    rings: current.rings.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  });

  /** A keystroke: the value goes out as typed, unclamped and unsorted. */
  const typed = (input: HTMLInputElement) => {
    dirty.add(input);
    if (input === heightInput) {
      const h = lengths.value(heightInput);
      // Rings typed before the height get their place now.
      const rings = current.rings.map((r) => {
        const above = lengths.value(rows.get(r.id)!.above);
        return Number.isFinite(r.position) || !(h > 0) || !Number.isFinite(above) ? r : { ...r, position: above / h };
      });
      current = { height: h, rings };
      if (note?.on === "height") note = null;
      // The rings keep their fractions, so their heights above the table follow.
      if (heightOk()) for (const row of rows.values()) fill(row);
      relabel();
      onChange(current, null);
      return;
    }
    const field = ringField(input);
    if (!field) return;
    const { row, column } = field;
    if (column === "above") {
      current = withRing(row.id, { position: heightOk() ? lengths.value(row.above) / height() : Number.NaN });
    } else {
      const c = column === "around" ? lengths.value(row.around) : lengths.value(row.across) * Math.PI;
      // The other field follows exactly, so going back and forth never drifts.
      if (column === "around") lengths.set(row.across, Number.isFinite(c) ? c / Math.PI : null);
      else lengths.set(row.around, Number.isFinite(c) ? c : null);
      current = withRing(row.id, { circumference: c });
    }
    if (note?.on === row.id) note = null;
    relabel();
    onChange(current, row.id);
  };

  /** Blur or Enter: the typed value goes through the ring-edit rules and the rows re-sort. */
  const commit = (input: HTMLInputElement) => {
    if (!dirty.delete(input)) return;
    const units = lengths.units();
    if (input === heightInput) {
      const h = lengths.value(heightInput);
      // An empty or impossible height is left for the core's warning.
      if (!(h > 0)) return;
      const start = { height: Number.isFinite(base.height) && base.height > 0 ? base.height : h, rings: current.rings };
      const edit = typeHeight(start, h, units);
      apply(edit.measurements, null, noteOn("height", edit.note));
      return;
    }
    const field = ringField(input);
    if (!field) return;
    const { row, column } = field;
    if (column === "above") {
      const above = lengths.value(row.above);
      if (!Number.isFinite(above) || !heightOk()) return;
      const edit = typeRingHeight(current, row.id, above, units);
      apply(sortRings(edit.measurements), row.id, noteOn(row.id, edit.note, edit.warning), row.id);
    } else {
      const c = lengths.value(row.around);
      if (!Number.isFinite(c)) return;
      const edit = typeCircumference(current, row.id, c, { units, ball });
      apply(edit.measurements, row.id, noteOn(row.id, edit.note));
    }
  };

  form.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLInputElement) base = current;
    // Selection follows focus (never the other way): a ring's row, or the Height. A ball has no selection.
    if (ball || !(e.target instanceof Element)) return;
    const id = e.target.closest<HTMLElement>(".ring")?.dataset.ring;
    const next = id !== undefined ? Number(id) : e.target === heightInput ? "height" : null;
    if (next !== null && next !== selected) links.select(next);
  });
  // Hover, both ways: a row points at its ring in the view, an insert button at its gap.
  const pointAt = (target: EventTarget | null): RingId | Gap | null => {
    if (ball || !(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>(".insert-ring");
    if (button) return [...gaps.values()].find((g) => g.button === button)?.gap ?? null;
    const id = target.closest<HTMLElement>(".ring")?.dataset.ring;
    return id === undefined ? null : Number(id);
  };
  const hover = (next: RingId | Gap | null) => {
    if (!sameTarget(next, hovered)) links.hover(next);
  };
  table.addEventListener("mouseover", (e) => hover(pointAt(e.target)));
  table.addEventListener("mouseleave", () => hover(null));
  // A focused insert button shows its gap in the view too, for the keyboard.
  table.addEventListener("focusin", (e) => {
    if (e.target instanceof Element && e.target.closest(".insert-ring")) hover(pointAt(e.target));
  });
  table.addEventListener("focusout", (e) => {
    if (e.target instanceof Element && e.target.closest(".insert-ring") && !table.matches(":hover")) hover(null);
  });
  form.addEventListener("input", (e) => {
    if (e.target instanceof HTMLInputElement) typed(e.target);
  });
  form.addEventListener("change", (e) => {
    if (e.target instanceof HTMLInputElement) commit(e.target);
  });
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    commit(e.target);
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    show(m) {
      current = m;
      layout();
    },
    setUnits(next) {
      lengths.setUnits(next);
      // A note is worded in the units it was given in.
      note = null;
      relabel();
    },
    setBall(next) {
      if (next === ball) return;
      ball = next;
      layout();
    },
    showWarnings(warnings, edited) {
      const show = (el: HTMLElement, messages: string[]) => {
        el.textContent = messages.join(" ");
        el.hidden = messages.length === 0;
      };
      // A ring warning's index is into the measurements shown; in test-grid mode only the ball's row shows.
      const shown = (ball ? current.rings.slice(0, 1) : current.rings).map((r) => r.id);
      const placed = placeMeasureWarnings(warnings, shown, edited);
      show(form.querySelector<HTMLElement>("#m-height-warning")!, placed.height);
      heightInput.setAttribute("aria-invalid", String(placed.height.length > 0));
      show(ringsWarning, placed.table);
      for (const row of rows.values()) {
        const messages = placed.rings.get(row.id) ?? [];
        show(row.warning, messages);
        for (const el of [row.above, row.around, row.across]) el.setAttribute("aria-invalid", String(messages.length > 0));
      }
    },
    showLinks(nextSelected, nextHovered, scroll) {
      const changed = nextSelected !== selected;
      selected = nextSelected;
      hovered = nextHovered;
      mark();
      if (!scroll || !changed || selected === null) return;
      scrollIntoPane(selected === "height" ? heightRow : rows.get(selected)?.el);
    },
  };
}

function sameTarget(a: RingId | Gap | null, b: RingId | Gap | null): boolean {
  if (a === null || b === null || typeof a === "number" || typeof b === "number") return a === b;
  return a.above === b.above && a.below === b.below;
}

/**
 * Scroll `el` into view within the pane that scrolls it (the controls pane beside the views), only as far as
 * needed. When only the page scrolls (the narrow, stacked layout) it's left alone: scrolling the page would take
 * the view being clicked out of sight.
 */
function scrollIntoPane(el: HTMLElement | undefined): void {
  if (!el || el.offsetParent === null) return;
  let pane = el.parentElement;
  while (pane && pane !== document.body) {
    const overflow = getComputedStyle(pane).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && pane.scrollHeight > pane.clientHeight) break;
    pane = pane.parentElement;
  }
  if (!pane || pane === document.body) return;
  const box = el.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (box.top < view.top) pane.scrollBy({ top: box.top - view.top, behavior });
  else if (box.bottom > view.bottom) pane.scrollBy({ top: Math.min(box.bottom - view.bottom, box.top - view.top), behavior });
}
