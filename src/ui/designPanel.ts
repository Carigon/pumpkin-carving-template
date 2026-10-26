import type { Design, Placement, TemplateWarning, Units } from "../core";
import { readSvgDesign } from "../input/svgDesign";
import { mountHandTraceCanvas } from "./handTraceCanvas";
import { lengthFields } from "./lengthFields";
import { mountTracePanel } from "./tracePanel";
import { designWarningText, renderWarnings } from "./warnings";

/** In mm; centered. */
const DEFAULTS_MM = { width: 150, verticalOffset: 0 };
const MAX_ROTATION = 30;
/** The file input's hint, shown until a file's status replaces it. */
const FILE_HINT = "Photos never leave your browser.";

export interface DesignPanel {
  design(): Design | null;
  placement(): Placement;
  /** A photo or a blank page is loaded and still being traced (the carver hasn't pressed Done). */
  tracing(): boolean;
  /** An image design is loaded, being traced or with its trace accepted. */
  hasImage(): boolean;
  /** A hand-trace on a blank page is loaded, being traced or Done. */
  hasPage(): boolean;
  /** How many of the hand-trace's shapes are open (not carved); null with no hand-trace loaded. */
  openShapes(): number | null;
  /** Show the length fields in `units` display units. */
  setUnits(units: Units): void;
  /** Show design-related warnings: where the design lands, and shapes that won't carve well. */
  showWarnings(warnings: TemplateWarning[]): void;
  /** Put back saved placement values (width null = empty), in mm. Doesn't call `onChange`. */
  restorePlacement(saved: Partial<{ width: number | null; verticalOffset: number; rotation: number }>): void;
}

/**
 * SVG upload plus placement controls: front-view width, vertical offset and rotation.
 * Calls `onChange` whenever the design or its placement changes, or the trace is accepted. An image's crop
 * and auto-trace result go in `photoView` (the viewport's Photo view); a hand-trace on a blank page in `pageView`
 * (the Page view).
 */
export function mountDesignPanel(
  root: HTMLElement,
  onChange: () => void,
  photoView: HTMLElement,
  pageView: HTMLElement,
): DesignPanel {
  root.innerHTML = `
    <form class="design" novalidate>
      <section class="card design-source">
      <h2>Design</h2>
      <div class="field">
        <label for="d-file">SVG file or photo</label>
        <input id="d-file" type="file" accept=".svg,image/svg+xml,image/*" />
        <div class="hint" id="d-file-status">${FILE_HINT}</div>
      </div>
      <button type="button" id="d-blank">Hand-trace on a blank page</button>
      <div id="d-trace"></div>
      <div id="d-hand-trace" class="trace-accept-row" hidden>
        <button type="button" class="trace-accept">Done</button>
        <div class="hint trace-accepted-note" hidden>Hand-trace done. Pick Page above the preview to see it again.</div>
      </div>
      </section>
      <section class="card">
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
      </section>
    </form>
  `;

  const form = root.querySelector("form")!;
  const $ = <T extends HTMLElement>(id: string) => form.querySelector<T>(`#${id}`)!;
  const file = $<HTMLInputElement>("d-file");
  const status = $<HTMLElement>("d-file-status");
  const width = $<HTMLInputElement>("d-width");
  const offset = $<HTMLInputElement>("d-offset");
  const rotation = $<HTMLInputElement>("d-rotation");
  const rotationRange = $<HTMLInputElement>("d-rotation-range");
  const warningsEl = $<HTMLElement>("d-warnings");

  const lengths = lengthFields(form, [width, offset]);
  lengths.set(width, DEFAULTS_MM.width);
  lengths.set(offset, DEFAULTS_MM.verticalOffset);
  let design: Design | null = null;
  let warnings: TemplateWarning[] = [];
  const showWarnings = () =>
    renderWarnings(warningsEl, warnings, "design", (w) => designWarningText(w, { units: lengths.units(), autoTrace: trace.loaded() }));
  const showStatus = (text: string, failed: boolean) => {
    status.textContent = text;
    status.classList.toggle("warning-text", failed);
  };
  const traceEl = $<HTMLElement>("d-trace");
  const trace = mountTracePanel(
    traceEl,
    (traced, text, failed) => {
      design = traced;
      showStatus(text, failed);
      onChange();
    },
    photoView,
    onChange,
  );

  const handTrace = mountHandTraceCanvas(pageView, () => {
    design = handTrace.editor()?.design() ?? null;
    onChange();
  });
  const handTraceEl = $<HTMLElement>("d-hand-trace");
  const handTraceAccept = handTraceEl.querySelector<HTMLButtonElement>(".trace-accept")!;
  const handTraceNote = handTraceEl.querySelector<HTMLElement>(".trace-accepted-note")!;
  const handTraceDone = () => handTrace.editor()?.isDone() ?? false;
  const showHandTrace = () => {
    handTraceEl.hidden = handTrace.editor() === null;
    handTraceAccept.textContent = handTraceDone() ? "Edit" : "Done";
    handTraceNote.hidden = !handTraceDone();
  };
  handTraceAccept.addEventListener("click", () => {
    handTrace.setDone(!handTraceDone());
    showHandTrace();
    onChange();
  });
  /** Loading another design replaces the hand-trace: ask first, only when it has points. */
  const mayReplaceHandTrace = () =>
    (handTrace.editor()?.counts().points ?? 0) === 0 || window.confirm("Discard your hand-trace?");
  const dropHandTrace = () => {
    handTrace.clear();
    showHandTrace();
  };
  $<HTMLButtonElement>("d-blank").addEventListener("click", () => {
    if (!mayReplaceHandTrace()) return;
    trace.clear();
    file.value = "";
    handTrace.startBlankPage();
    showHandTrace();
    design = null;
    showStatus(FILE_HINT, false);
    onChange();
  });

  async function load() {
    const f = file.files?.[0];
    if (!f) return;
    if (!mayReplaceHandTrace()) {
      file.value = "";
      return;
    }
    dropHandTrace();
    if (f.type.startsWith("image/") && f.type !== "image/svg+xml") {
      design = null;
      showStatus("Auto-tracing…", false);
      onChange();
      await trace.load(f);
      return;
    }
    trace.clear();
    const { design: read, notes } = readSvgDesign(await f.text());
    design = read;
    const count = read ? `${read.paths.length} shape${read.paths.length === 1 ? "" : "s"} loaded.` : "";
    showStatus([count, ...notes].filter(Boolean).join(" "), read === null);
    onChange();
  }
  file.addEventListener("change", () => void load());
  rotationRange.addEventListener("input", () => {
    rotation.value = rotationRange.value;
  });
  rotation.addEventListener("input", () => {
    rotationRange.value = rotation.value;
  });
  form.addEventListener("input", (e) => {
    if (e.target !== file && !traceEl.contains(e.target as Node)) onChange();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return {
    design: () => design,
    tracing: () => (trace.loaded() && !trace.accepted()) || (handTrace.editor() !== null && !handTraceDone()),
    hasImage: () => trace.loaded(),
    hasPage: () => handTrace.editor() !== null,
    openShapes: () => handTrace.editor()?.counts().open ?? null,
    placement: () => ({
      width: lengths.value(width),
      verticalOffset: lengths.value(offset) || 0,
      rotation: num(rotation.value) || 0,
    }),
    restorePlacement(saved) {
      if (saved.width !== undefined) lengths.set(width, saved.width);
      if (saved.verticalOffset !== undefined) lengths.set(offset, saved.verticalOffset);
      if (saved.rotation !== undefined) rotation.value = rotationRange.value = String(saved.rotation);
    },
    setUnits(next: Units) {
      lengths.setUnits(next);
      showWarnings();
    },
    showWarnings(next: TemplateWarning[]) {
      warnings = next;
      showWarnings();
    },
  };
}

function num(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}
