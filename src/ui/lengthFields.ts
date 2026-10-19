import { convertLength, type Units } from "../core";

/**
 * Length inputs that follow the measurement units. Each field keeps its exact value: switching units
 * converts that value and only rounds what is shown, so switching back and forth never drifts, and
 * `value` reads the exact value until the carver types something new.
 */
export interface LengthFields {
  /** The field's value in the current units; NaN when empty or not a number. */
  value(input: HTMLInputElement): number;
  /** Set a field to a value in the current units (null = empty). */
  set(input: HTMLInputElement, value: number | null): void;
  /** Start or stop following unit switches for a field created or removed later (e.g. a ring row). */
  add(input: HTMLInputElement): void;
  remove(input: HTMLInputElement): void;
  /** Convert every field (and the `.unit-label`s under `root`) to `next` units. */
  setUnits(next: Units): void;
  units(): Units;
}

export function lengthFields(root: HTMLElement, initialInputs: HTMLInputElement[], initial: Units = "in"): LengthFields {
  let units = initial;
  const inputs = new Set(initialInputs);
  /** Exact value behind each field, with the text shown for it. */
  const exact = new Map<HTMLInputElement, { value: number; shown: string }>();

  const value = (input: HTMLInputElement): number => {
    const kept = exact.get(input);
    if (kept && kept.shown === input.value) return kept.value;
    return input.value.trim() === "" ? Number.NaN : Number(input.value);
  };
  const set = (input: HTMLInputElement, v: number | null) => {
    if (v === null || !Number.isFinite(v)) {
      exact.delete(input);
      input.value = v === null ? "" : input.value;
      return;
    }
    const shown = String(Math.round(v * 100) / 100);
    exact.set(input, { value: v, shown });
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
      for (const input of inputs) {
        const v = value(input);
        if (Number.isFinite(v)) set(input, convertLength(v, units, next));
      }
      root.querySelectorAll(".unit-label").forEach((el) => (el.textContent = next));
      units = next;
    },
  };
}
