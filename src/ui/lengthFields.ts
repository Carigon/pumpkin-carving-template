import type { Units } from "../core";
import { shownLength, toMm } from "../displayUnits";

/**
 * Length inputs that hold mm and show them in the display units. Each field keeps its exact mm value behind the
 * rounded text it shows, so switching units only redraws the text and never drifts, and `value` reads the exact
 * value until the carver types something new.
 */
export interface LengthFields {
  /** The field's value in mm; NaN when empty or not a number. */
  value(input: HTMLInputElement): number;
  /** Set a field to a value in mm (null = empty). */
  set(input: HTMLInputElement, mm: number | null): void;
  /** Start or stop following unit switches for a field created or removed later (e.g. a ring row). */
  add(input: HTMLInputElement): void;
  remove(input: HTMLInputElement): void;
  /** Show every field (and the `.unit-label`s under `root`) in `next` display units. */
  setUnits(next: Units): void;
  units(): Units;
}

export function lengthFields(root: HTMLElement, initialInputs: HTMLInputElement[], initial: Units = "in"): LengthFields {
  let units = initial;
  const inputs = new Set(initialInputs);
  /** Exact mm value behind each field, with the text shown for it. */
  const exact = new Map<HTMLInputElement, { mm: number; shown: string }>();

  const value = (input: HTMLInputElement): number => {
    const kept = exact.get(input);
    if (kept && kept.shown === input.value) return kept.mm;
    return input.value.trim() === "" ? Number.NaN : toMm(Number(input.value), units);
  };
  const set = (input: HTMLInputElement, mm: number | null) => {
    if (mm === null || !Number.isFinite(mm)) {
      exact.delete(input);
      input.value = mm === null ? "" : input.value;
      return;
    }
    const shown = shownLength(mm, units);
    exact.set(input, { mm, shown });
    input.value = shown;
  };

  return {
    value,
    set,
    units: () => units,
    add: (input) => void inputs.add(input),
    remove(input) {
      inputs.delete(input);
      exact.delete(input);
    },
    setUnits(next) {
      if (next === units) return;
      const values = [...inputs].map((input) => [input, value(input)] as const);
      units = next;
      for (const [input, mm] of values) if (Number.isFinite(mm)) set(input, mm);
      root.querySelectorAll(".unit-label").forEach((el) => (el.textContent = next));
    },
  };
}
