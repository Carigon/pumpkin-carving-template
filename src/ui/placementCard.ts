import type { Placement, TemplateWarning, Units } from "../core";
import { lengthFields } from "./lengthFields";
import { designWarningText, renderWarnings, type DesignWarningContext } from "./warnings";

/** In mm; centered. */
const DEFAULTS_MM = { width: 150, verticalOffset: 0 };
const MAX_ROTATION = 30;

export interface PlacementCard {
  placement(): Placement;
  /** The placed Width in mm, or the default while the field is empty or not above 0: a hand-trace file's width. */
  fileWidth(): number;
  /** Put back saved placement values (width null = empty), in mm. */
  restore(saved: Partial<{ width: number | null; verticalOffset: number; rotation: number }>): void;
  /** Show the length fields, and the warnings' lengths, in `units` display units. */
  setUnits(units: Units): void;
  /** Show design-related warnings: where the design lands, and shapes that won't carve well. */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Word the warnings showing again, for the design's source now. */
  rewordWarnings(): void;
}

/**
 * The Placement card, in `root`: front-view width, vertical offset and rotation, then the design's warnings, worded
 * for where the design comes from (`source`). Its inputs bubble to the Design card's form.
 */
export function mountPlacementCard(root: HTMLElement, source: () => DesignWarningContext["source"]): PlacementCard {
  root.innerHTML = `
      <h2>Placement</h2>
      <div class="field">
        <label for="d-width">Width seen from the front</label>
        <div class="input-row">
          <input id="d-width" type="number" inputmode="decimal" min="0" step="any" />
          <span class="unit-label">in</span>
        </div>
      </div>
      <div class="field">
        <label for="d-offset">Move up (negative = down)</label>
        <div class="input-row">
          <input id="d-offset" type="number" inputmode="decimal" step="any" />
          <span class="unit-label">in</span>
        </div>
      </div>
      <div class="field">
        <label for="d-rotation">Rotation</label>
        <div class="input-row">
          <input id="d-rotation-range" type="range" min="${-MAX_ROTATION}" max="${MAX_ROTATION}" step="0.5" value="0"
            aria-label="Rotation slider" />
          <input id="d-rotation" type="number" step="0.5" value="0" />
          <span>°</span>
        </div>
        <div class="hint">Counterclockwise as seen from the front.</div>
      </div>
      <div id="d-warnings" class="warnings" role="alert"></div>
  `;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const width = $<HTMLInputElement>("d-width");
  const offset = $<HTMLInputElement>("d-offset");
  const rotation = $<HTMLInputElement>("d-rotation");
  const rotationRange = $<HTMLInputElement>("d-rotation-range");
  const warningsEl = $<HTMLElement>("d-warnings");

  const lengths = lengthFields(root, [width, offset]);
  lengths.set(width, DEFAULTS_MM.width);
  lengths.set(offset, DEFAULTS_MM.verticalOffset);
  let warnings: TemplateWarning[] = [];
  const rewordWarnings = () =>
    renderWarnings(warningsEl, warnings, "design", (w) =>
      designWarningText(w, { units: lengths.units(), source: source() }),
    );
  rotationRange.addEventListener("input", () => {
    rotation.value = rotationRange.value;
  });
  rotation.addEventListener("input", () => {
    rotationRange.value = rotation.value;
  });

  return {
    placement: () => ({
      width: lengths.value(width),
      verticalOffset: lengths.value(offset) || 0,
      rotation: num(rotation.value) || 0,
    }),
    fileWidth() {
      const placed = lengths.value(width);
      return placed > 0 ? placed : DEFAULTS_MM.width;
    },
    restore(saved) {
      if (saved.width !== undefined) lengths.set(width, saved.width);
      if (saved.verticalOffset !== undefined) lengths.set(offset, saved.verticalOffset);
      if (saved.rotation !== undefined) rotation.value = rotationRange.value = String(saved.rotation);
    },
    setUnits(next) {
      lengths.setUnits(next);
      rewordWarnings();
    },
    showWarnings(next) {
      warnings = next;
      rewordWarnings();
    },
    rewordWarnings,
  };
}

function num(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}
