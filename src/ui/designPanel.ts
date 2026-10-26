import type { Design, Placement, TemplateWarning, Units } from "../core";
import type { DesignRecord, PhotoFile, RecordKeeper } from "../designRecord";
import { handTraceFileName, readHandTraceFile, writeHandTraceFile } from "../input/handTraceFile";
import { downloadBlob } from "./download";
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
  /**
   * Put back the kept design and its work, silently, unless the carver has loaded one meanwhile. Calls `onChange`
   * when there was one.
   */
  restoreDesign(): Promise<void>;
}

/**
 * SVG upload plus placement controls: front-view width, vertical offset and rotation.
 * Calls `onChange` whenever the design or its placement changes, or the trace is accepted. A photo's cleanup
 * and auto-trace result go in `photoView` (the viewport's Photo view); a hand-trace on a blank page in `pageView`
 * (the Page view). The loaded design and the work on it are kept across reloads by `keeper` (ADR 0002).
 */
export function mountDesignPanel(
  root: HTMLElement,
  onChange: () => void,
  photoView: HTMLElement,
  pageView: HTMLElement,
  keeper: RecordKeeper,
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
        <button type="button" data-download-svg>Download SVG</button>
      </div>
      <div class="hint" id="d-not-kept" hidden>This browser won't keep your work after a reload.
        <button type="button" class="link-button" data-download-svg>Download SVG</button></div>
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
  /** The loaded SVG design's file, until another design replaces it. */
  let svg: { name: string; text: string } | null = null;
  /** The loaded photo as chosen, until another design replaces it. */
  let photo: PhotoFile | null = null;
  /** The kept design was restored, or the carver loaded one first: from now on the work is kept. */
  let keeping = false;
  const notKept = $<HTMLElement>("d-not-kept");

  /** The loaded design and the work on it, as the record keeps it; null with none loaded. */
  const record = (): DesignRecord | null => {
    const editor = handTrace.editor();
    if (editor) return { source: "page", page: editor.page(), handTrace: editor.record() };
    if (photo && trace.loaded())
      return { source: "photo", photo, cleanup: trace.cleanup(), autoTrace: trace.autoTrace(), done: trace.accepted() };
    return svg && { source: "svg", svg };
  };
  /** Keep the work after a finished change; once that fails, say so, quietly and for good. */
  const keep = () => {
    if (!keeping) return;
    void keeper.keep(record()).then(() => {
      notKept.hidden = keeper.keepsWork();
    });
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
    () => {
      onChange();
      keep();
    },
    keep,
  );
  // A slider released, Invert ticked or a speckle size typed: a finished change to auto-trace's settings.
  traceEl.addEventListener("change", keep);

  const handTrace = mountHandTraceCanvas(
    pageView,
    () => {
      design = handTrace.editor()?.design() ?? null;
      onChange();
    },
    () => {
      showHandTrace(); // a point placed or deleted: Download SVG may have changed
      keep();
    },
  );
  const handTraceEl = $<HTMLElement>("d-hand-trace");
  const handTraceAccept = handTraceEl.querySelector<HTMLButtonElement>(".trace-accept")!;
  const handTraceNote = handTraceEl.querySelector<HTMLElement>(".trace-accepted-note")!;
  /** Download SVG, below Done/Edit and in the "won't keep your work" line. */
  const downloads = Array.from(form.querySelectorAll<HTMLButtonElement>("[data-download-svg]"));
  const handTraceDone = () => handTrace.editor()?.isDone() ?? false;
  const showHandTrace = () => {
    const editor = handTrace.editor();
    handTraceEl.hidden = editor === null;
    handTraceAccept.textContent = handTraceDone() ? "Edit" : "Done";
    handTraceNote.hidden = !handTraceDone();
    for (const b of downloads) {
      b.hidden = editor === null;
      b.disabled = (editor?.counts().points ?? 0) === 0;
    }
  };
  /** Download the hand-trace as a hand-trace file, at the placed Width (the default while the field is empty). */
  const downloadSvg = () => {
    const editor = handTrace.editor();
    if (!editor) return;
    const placed = lengths.value(width);
    const text = writeHandTraceFile({
      record: { source: "page", page: editor.page(), handTrace: editor.record() },
      pathData: editor.pathData(),
      design: editor.design(),
      width: placed > 0 ? placed : DEFAULTS_MM.width,
    });
    downloadBlob(new Blob([text], { type: "image/svg+xml" }), handTraceFileName(new Date()));
  };
  for (const b of downloads) b.addEventListener("click", downloadSvg);
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
    keeping = true;
    trace.clear();
    [svg, photo] = [null, null];
    file.value = "";
    handTrace.startBlankPage();
    showHandTrace();
    design = null;
    showStatus(FILE_HINT, false);
    onChange();
    keep();
  });

  /**
   * Open an SVG file: a hand-trace file reopens as its hand-trace, restored as after a reload; any other is an SVG
   * design, kept as that file while it reads as one.
   */
  const openSvg = (name: string, text: string) => {
    const opened = readHandTraceFile(text);
    if (opened.kind === "hand-trace") {
      handTrace.startBlankPage(opened.record);
      design = handTrace.editor()?.design() ?? null;
      showHandTrace();
      return showStatus("Reopened your hand-trace.", false);
    }
    const read = opened.design;
    design = read;
    svg = read && { name, text };
    const count = read ? `${read.paths.length} shape${read.paths.length === 1 ? "" : "s"} loaded.` : "";
    showStatus([count, ...opened.notes].filter(Boolean).join(" "), read === null);
  };

  async function load() {
    const f = file.files?.[0];
    if (!f) return;
    if (!mayReplaceHandTrace()) {
      file.value = "";
      return;
    }
    keeping = true;
    dropHandTrace();
    [svg, photo] = [null, null];
    if (f.type.startsWith("image/") && f.type !== "image/svg+xml") {
      design = null;
      showStatus("Frame the sheet in the photo, then press Start tracing.", false);
      onChange();
      photo = { name: f.name, type: f.type, bytes: await f.arrayBuffer() };
      await trace.load(f);
      onChange(); // the photo shows in Cleanup now: its view comes up
      keep(); // The photo is written now, once; later keeps write only the work on it.
      return;
    }
    trace.clear();
    openSvg(f.name, await f.text());
    onChange();
    keep();
  }

  /** Put the kept design back as it was left: the same source, settings, shapes and Done. */
  async function restoreDesign() {
    const kept = await keeper.restore();
    if (keeping) return; // The carver loaded a design while it was being read.
    keeping = true;
    if (!kept) return;
    if (kept.source === "svg") openSvg(kept.svg.name, kept.svg.text);
    else if (kept.source === "photo") {
      photo = kept.photo;
      const restored = new File([kept.photo.bytes], kept.photo.name, { type: kept.photo.type });
      await trace.load(restored, { cleanup: kept.cleanup, settings: kept.autoTrace, accepted: kept.done });
    } else {
      handTrace.startBlankPage(kept);
      design = handTrace.editor()?.design() ?? null;
      showHandTrace();
    }
    onChange();
  }
  // A phone may discard the tab once it's hidden: keep the work as it is then.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keep();
  });
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
    restoreDesign,
    setUnits(next: Units) {
      lengths.setUnits(next);
      showWarnings();
    },
    showWarnings(next: TemplateWarning[]) {
      warnings = next;
      showWarnings();
      // Only a hand-trace is marked: never an auto-trace result or an SVG design.
      handTrace.showWarnings(next);
    },
  };
}

function num(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}
