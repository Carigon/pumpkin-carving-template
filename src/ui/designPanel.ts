import type { Design, Placement, TemplateWarning, Units } from "../core";
import type { DesignRecord, PageRecord, PhotoFile, PhotoRecord, RecordKeeper } from "../designRecord";
import type { HandTraceRecord } from "../handTrace";
import { editOnStalePhoto, handTraceFileName, readHandTraceFile, writeHandTraceFile } from "../input/handTraceFile";
import { filePhoto } from "../input/shrinkPhoto";
import { autoTraceShapes, readSvgHandTrace, type SvgHandTrace } from "../input/svgHandTrace";
import { downloadBlob } from "./download";
import { toneFilter } from "./cleanupPanel";
import { mountHandTraceCanvas } from "./handTraceCanvas";
import { lengthFields } from "./lengthFields";
import { mountTracePanel } from "./tracePanel";
import { designWarningText, renderWarnings } from "./warnings";

/** In mm; centered. */
const DEFAULTS_MM = { width: 150, verticalOffset: 0 };
const MAX_ROTATION = 30;
/** The file input's hint, shown until a file's status replaces it. */
const FILE_HINT = "Photos never leave your browser.";
/** The status line while a photo is in Cleanup. */
const CLEANUP_HINT = "Frame the sheet in the photo, then press Start tracing.";
/** Above this many points, Edit as hand-trace warns that editing may be slow (a starting guess, to tune on phones). */
const MANY_POINTS = 2000;
/** A hand-trace with nothing drawn: a new photo's. */
const EMPTY_HAND_TRACE: HandTraceRecord = { shapes: [], drawing: null, done: false };

export interface DesignPanel {
  design(): Design | null;
  placement(): Placement;
  /** A photo or a blank page is loaded and still being traced (the carver hasn't pressed Done). */
  tracing(): boolean;
  /** An image design is loaded, being traced or with its trace accepted. */
  hasImage(): boolean;
  /** A hand-trace on a blank page is loaded, being traced or Done. */
  hasPage(): boolean;
  /**
   * The view the hand-trace canvas is in while the design is a hand-trace: the Photo view (a photo with hand-trace
   * chosen) or the Page view; null when the design isn't a hand-trace.
   */
  handTraceView(): "photo" | "page" | null;
  /** How many of the hand-trace's shapes are open (not carved); null while the design isn't a hand-trace. */
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
 * Calls `onChange` whenever the design or its placement changes, or the trace is accepted. A photo's cleanup, its
 * auto-trace result and its hand-trace go in `photoView` (the viewport's Photo view); a hand-trace on a blank page in
 * `pageView` (the Page view). The loaded design and the work on it are kept across reloads by `keeper` (ADR 0002).
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
      <div id="d-edit-svg" class="trace-accept-row" hidden>
        <button type="button">Edit as hand-trace</button>
        <div class="hint" hidden>This design has many points; editing may be slow.</div>
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
    renderWarnings(warningsEl, warnings, "design", (w) =>
      designWarningText(w, { units: lengths.units(), source: warningSource() }),
    );
  const warningSource = () => {
    if (trace.loaded()) return trace.method() === "auto" ? "auto-trace" : "hand-trace";
    return svg ? "svg" : "hand-trace";
  };
  const showStatus = (text: string, failed: boolean) => {
    status.textContent = text;
    status.classList.toggle("warning-text", failed);
  };
  /** The loaded SVG design's file, until another design replaces it. */
  let svg: { name: string; text: string } | null = null;
  /** The loaded photo as chosen, until another design replaces it. */
  let photo: PhotoFile | null = null;
  /** The SVG file a hand-trace on a page was made from by Edit as hand-trace; undefined for a blank page's. */
  let pageName: string | undefined;
  /** The kept design was restored, or the carver loaded one first: from now on the work is kept. */
  let keeping = false;
  const notKept = $<HTMLElement>("d-not-kept");

  /** The loaded photo's auto-trace result and its status line: kept while hand-trace is chosen. */
  let autoDesign: Design | null = null;
  let autoStatus = { text: "", failed: false };

  /** The loaded design and the work on it, as the record keeps it; null with none loaded. */
  const record = (): DesignRecord | null => {
    const editor = handTrace.editor();
    if (photo && trace.loaded())
      return {
        source: "photo",
        photo,
        cleanup: trace.cleanup(),
        tone: trace.tone(),
        inCleanup: trace.inCleanup(),
        autoTrace: trace.autoTrace(),
        handTrace: editor?.record() ?? EMPTY_HAND_TRACE,
        method: trace.method(),
        done: trace.accepted(),
      };
    const name = pageName === undefined ? {} : { name: pageName };
    if (editor) return { source: "page", page: editor.page(), handTrace: editor.record(), ...name };
    return svg && { source: "svg", svg };
  };
  /** Keep the work after a finished change; once that fails, say so, quietly and for good. */
  const keep = () => {
    if (!keeping) return;
    void keeper.keep(record()).then(() => {
      notKept.hidden = keeper.keepsWork();
    });
  };

  /** The design is the chosen method's result, even an empty one; a blank page's is its hand-trace's. */
  const pickDesign = () => {
    if (trace.loaded()) design = trace.method() === "auto" ? autoDesign : (handTrace.editor()?.design() ?? null);
    else if (handTrace.editor()) design = handTrace.editor()?.design() ?? null;
  };
  /** The photo's status line: Cleanup's hint, auto-trace's last word while it's chosen, else the file hint. */
  const showPhotoStatus = () => {
    if (autoStatus.failed || (trace.method() === "auto" && !trace.inCleanup()))
      return showStatus(autoStatus.text, autoStatus.failed);
    showStatus(trace.inCleanup() ? CLEANUP_HINT : FILE_HINT, false);
  };
  /** The photo's Done is the chosen method's: the hand-trace is Done only while it's chosen and accepted. */
  const syncDone = () => handTrace.setDone(trace.method() === "hand" && trace.accepted());
  /**
   * A released cleanup change carries the hand-trace's points with the photo, as one undo step (whichever method is
   * chosen: the hand-trace is kept beside auto-trace's result). The canvas reports the changed Design. A tone change
   * or a change of stage hands over the cleanup the editor has: no step.
   */
  const followCleanup = () => handTrace.changeCleanup(trace.cleanup(), false);
  /** An undo or redo of a cleanup change put the hand-trace's old cleanup back: the photo is cleaned up by it again. */
  const followUndo = () => {
    const cleanup = trace.loaded() ? handTrace.editor()?.cleanup() : null;
    if (cleanup && cleanup !== trace.cleanup()) trace.setCleanup(cleanup);
  };

  const traceEl = $<HTMLElement>("d-trace");
  const trace = mountTracePanel(traceEl, photoView, {
    onTraced(traced, text, failed) {
      [autoDesign, autoStatus] = [traced, { text, failed }];
      if (trace.loaded()) {
        pickDesign();
        showPhotoStatus();
      } else {
        // The photo couldn't be read.
        design = null;
        showStatus(text, failed);
      }
      onChange();
    },
    onAccepted() {
      syncDone();
      onChange();
      keep();
    },
    onCleanup() {
      followCleanup();
      handTrace.setTone(toneFilter(trace.tone()));
      showPhotoStatus();
      keep();
    },
    cleanupHooks: {
      onLive: () => handTrace.changeCleanup(trace.cleanup(), true),
      // Drawn over the photo while hand-trace is chosen: the shapes being traced.
      shapes: (toPhoto) => (trace.method() === "hand" ? (handTrace.editor()?.shapePaths(toPhoto) ?? null) : null),
      // Cleanup changes are steps in the hand-trace's history, whichever method is chosen: Cleanup steps through it.
      history: {
        can: () => handTrace.editor()?.drawn().can ?? { undo: false, redo: false },
        undo: () => handTrace.undo(),
        redo: () => handTrace.redo(),
      },
    },
    onCleaned: (href) => handTrace.setPhoto(href),
    onMethod() {
      syncDone();
      showHandTrace(); // Download SVG shows while hand-trace is chosen
      pickDesign();
      showPhotoStatus();
      showWarnings(); // auto-trace's lines carry its own hint
      onChange();
      keep();
    },
    onEditAuto() {
      const traced = trace.autoTraced();
      if (!traced || !handTrace.editor() || !mayReplace("Replace your hand-trace?")) return;
      trace.chooseMethod("hand");
      // Already in the cleaned-up photo's space: nothing moves. One undo step, which the canvas reports and keeps.
      handTrace.replace(autoTraceShapes(traced.svg, traced));
    },
  });
  // A slider released, Invert ticked or a speckle size typed: a finished change to auto-trace's settings.
  traceEl.addEventListener("change", keep);

  /** The hand-trace canvas: in the Page view on a blank page, in the Photo view over a photo. */
  const canvasHost = document.createElement("div");
  pageView.append(canvasHost);
  const handTrace = mountHandTraceCanvas(
    canvasHost,
    () => {
      followUndo();
      pickDesign();
      onChange();
    },
    () => {
      followUndo(); // before the record is kept: it holds the cleanup
      showHandTrace(); // a point placed or deleted: Download SVG may have changed
      keep();
    },
  );
  /** Start the photo's hand-trace over the cleaned-up photo, or reopen `kept`. */
  const startPhotoHandTrace = (kept?: HandTraceRecord) => {
    trace.handSlot.append(canvasHost);
    handTrace.startPhoto(trace.cleanups(), kept);
    handTrace.setTone(toneFilter(trace.tone()));
    showHandTrace();
  };
  /** Start a hand-trace on a blank page, or reopen `kept` (an edited SVG design's keeps its file's name). */
  const startBlankPage = (kept?: PageRecord) => {
    pageView.append(canvasHost);
    pageName = kept?.name;
    handTrace.startBlankPage(kept);
  };
  const handTraceEl = $<HTMLElement>("d-hand-trace");
  const handTraceAccept = handTraceEl.querySelector<HTMLButtonElement>(".trace-accept")!;
  const handTraceNote = handTraceEl.querySelector<HTMLElement>(".trace-accepted-note")!;
  /** Download SVG, below Done/Edit and in the "won't keep your work" line. */
  const downloads = Array.from(form.querySelectorAll<HTMLButtonElement>("[data-download-svg]"));
  /** The blank page's hand-trace; null over a photo, whose Done is the trace panel's. */
  const pageEditor = () => (photo ? null : handTrace.editor());
  const handTraceDone = () => pageEditor()?.isDone() ?? false;
  /** The hand-trace a Download SVG writes: the blank page's, or the photo's while hand-trace is chosen. */
  const chosenHandTrace = () => (handTraceView() ? handTrace.editor() : null);
  const showHandTrace = () => {
    const editor = chosenHandTrace();
    // Over a photo the row holds Download SVG only, below the trace panel's Done/Edit.
    handTraceEl.hidden = editor === null;
    handTraceAccept.hidden = pageEditor() === null;
    handTraceAccept.textContent = handTraceDone() ? "Edit" : "Done";
    handTraceNote.hidden = !handTraceDone();
    for (const b of downloads) {
      b.hidden = editor === null;
      b.disabled = (editor?.counts().points ?? 0) === 0;
    }
  };
  /** The loaded photo as its hand-trace file carries it, made once per photo. */
  let forFile: { of: PhotoFile; photo: Promise<PhotoFile> } | null = null;
  /** Download the hand-trace as a hand-trace file, at the placed Width (the default while the field is empty). */
  const downloadSvg = async () => {
    const editor = chosenHandTrace();
    const kept = record();
    if (!editor || !kept || kept.source === "svg") return;
    if (kept.source === "photo" && forFile?.of !== kept.photo) {
      const chosen = kept.photo;
      // A photo that loaded but won't decode again here goes in as chosen.
      forFile = { of: chosen, photo: filePhoto(chosen).catch(() => chosen) };
    }
    const fileRecord = kept.source === "photo" && forFile ? { ...kept, photo: await forFile.photo } : kept;
    const placed = lengths.value(width);
    const text = writeHandTraceFile({
      record: fileRecord,
      page: editor.page(),
      pathData: editor.pathData(),
      design: editor.design(),
      width: placed > 0 ? placed : DEFAULTS_MM.width,
    });
    const name = kept.source === "photo" ? kept.photo.name : kept.name;
    downloadBlob(new Blob([text], { type: "image/svg+xml" }), handTraceFileName(new Date(), name));
  };
  for (const b of downloads) b.addEventListener("click", () => void downloadSvg());
  handTraceAccept.addEventListener("click", () => {
    handTrace.setDone(!handTraceDone());
    showHandTrace();
    onChange();
  });
  /** Replacing the hand-trace asks `question` first, only when the hand-trace has points. */
  function mayReplace(question: string): boolean {
    return (handTrace.editor()?.counts().points ?? 0) === 0 || window.confirm(question);
  }
  /** Loading another design replaces the hand-trace. */
  const mayReplaceHandTrace = () => mayReplace("Discard your hand-trace?");
  const dropHandTrace = () => {
    handTrace.clear();
    showHandTrace();
  };
  $<HTMLButtonElement>("d-blank").addEventListener("click", () => {
    if (!mayReplaceHandTrace()) return;
    keeping = true;
    trace.clear();
    [svg, photo] = [null, null];
    showEditSvg();
    file.value = "";
    startBlankPage();
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
  const openSvg = async (name: string, text: string) => {
    const opened = readHandTraceFile(text);
    if (opened.kind === "hand-trace") {
      if (opened.record.source === "photo") {
        await openPhoto(opened.record);
        if (!trace.loaded()) return; // its photo couldn't be read: that status stands
      } else openPage(opened.record);
      return showStatus("Reopened your hand-trace.", false);
    }
    const read = opened.design;
    design = read;
    svg = read && { name, text };
    const count = read ? `${read.paths.length} shape${read.paths.length === 1 ? "" : "s"} loaded.` : "";
    showStatus([count, ...opened.notes].filter(Boolean).join(" "), read === null);
    showEditSvg();
  };

  const editSvg = $<HTMLElement>("d-edit-svg");
  const manyPoints = editSvg.querySelector<HTMLElement>(".hint")!;
  /** The loaded SVG design as a hand-trace, worked out once per file: what Edit as hand-trace lands on. */
  let svgHandTrace: { of: string; read: SvgHandTrace | null } | null = null;
  const editedSvg = () => {
    if (!svg) return null;
    if (svgHandTrace?.of !== svg.text) svgHandTrace = { of: svg.text, read: readSvgHandTrace(svg.text) };
    return svgHandTrace.read;
  };
  /** Edit as hand-trace shows for an SVG design with at least one shape, with a hint when it has a great many points. */
  const showEditSvg = () => {
    const edited = editedSvg();
    const shapes = edited?.handTrace.shapes ?? [];
    editSvg.hidden = shapes.length === 0;
    manyPoints.hidden = shapes.reduce((n, s) => n + s.points.length, 0) <= MANY_POINTS;
  };
  /**
   * Edit as hand-trace: the SVG design becomes a hand-trace for good, looking as it did; the file isn't kept. A
   * hand-trace file changed in another program goes back over its stale record's photo, as that photo's hand-trace,
   * when the photo still reads; any other lands on a page shaped to it, in the Page view, the loader's notes staying
   * on the status line. It asks nothing.
   */
  editSvg.querySelector("button")!.addEventListener("click", () => void editSvgDesign());
  async function editSvgDesign() {
    const edited = editedSvg();
    if (!svg || !edited) return;
    const { name, text } = svg;
    svg = null;
    showEditSvg();
    const onPhoto = editOnStalePhoto(text);
    if (onPhoto) await openPhoto(onPhoto);
    if (!trace.loaded()) {
      photo = null; // none, or it wouldn't read: a page instead
      startBlankPage({ source: "page", ...edited, name });
      design = handTrace.editor()?.design() ?? null;
    }
    showHandTrace();
    onChange();
    keep();
  }

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
    showEditSvg();
    if (f.type.startsWith("image/") && f.type !== "image/svg+xml") {
      [design, autoDesign, autoStatus] = [null, null, { text: "", failed: false }];
      showStatus(CLEANUP_HINT, false);
      onChange();
      photo = { name: f.name, type: f.type, bytes: await f.arrayBuffer() };
      await trace.load(f);
      if (trace.loaded()) startPhotoHandTrace(); // a new photo starts on hand-trace, with nothing drawn
      onChange(); // the photo shows in Cleanup now: its view comes up
      keep(); // The photo is written now, once; later keeps write only the work on it.
      return;
    }
    trace.clear();
    await openSvg(f.name, await f.text());
    onChange();
    keep(); // a reopened photo is kept as its file carried it
  }

  /** Put a photo and its work back as they were left, from a reload or a reopened hand-trace file. */
  async function openPhoto(kept: PhotoRecord) {
    photo = kept.photo;
    const restored = new File([kept.photo.bytes], kept.photo.name, { type: kept.photo.type });
    const { cleanup, tone, inCleanup, autoTrace: settings, method, done: accepted } = kept;
    await trace.load(restored, { cleanup, tone, inCleanup, settings, method, accepted });
    if (trace.loaded()) startPhotoHandTrace({ ...kept.handTrace, done: method === "hand" && accepted });
    pickDesign();
    showPhotoStatus();
  }
  /** Put a blank page and its hand-trace back as they were left, from a reload or a reopened hand-trace file. */
  function openPage(kept: PageRecord) {
    startBlankPage(kept);
    design = handTrace.editor()?.design() ?? null;
    showHandTrace();
  }

  /** Put the kept design back as it was left: the same source, settings, shapes and Done. */
  async function restoreDesign() {
    const kept = await keeper.restore();
    if (keeping) return; // The carver loaded a design while it was being read.
    keeping = true;
    if (!kept) return;
    if (kept.source === "svg") await openSvg(kept.svg.name, kept.svg.text);
    else if (kept.source === "photo") await openPhoto(kept);
    else openPage(kept);
    onChange();
  }
  function handTraceView(): "photo" | "page" | null {
    if (trace.loaded()) return trace.method() === "hand" ? "photo" : null;
    return pageEditor() ? "page" : null;
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
    tracing: () => (trace.loaded() ? !trace.accepted() : pageEditor() !== null && !handTraceDone()),
    hasImage: () => trace.loaded(),
    hasPage: () => pageEditor() !== null,
    handTraceView,
    openShapes: () => (handTraceView() ? (handTrace.editor()?.counts().open ?? null) : null),
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
