import type { Design } from "../core";
import {
  AUTO_TRACE_DEFAULTS as DEFAULTS,
  MAX_SPECKLE,
  THRESHOLD_RANGE,
  TONE_DEFAULTS,
  type AutoTraceSettings,
  type Tone,
  type TracingMethod,
} from "../designRecord";
import type { Page } from "../handTrace";
import { exifFocal35Mm, photoPage, START_FRAME, type Cleanup } from "../input/cleanupFrame";
import { fitWithin } from "../input/rasterPrep";
import { startCleanupWarp } from "../worker/cleanupWarp";
import { mountCleanupPanel, toneFilter } from "./cleanupPanel";

const RETRACE_DELAY_MS = 150;
/**
 * The photo's long side once decoded, in px (shrunk with the browser's high-quality filter): a sheet filling two
 * thirds of the photo still gets the cleaned-up photo's 2000 px, and the warp never shrinks much, which it does
 * poorly.
 */
const MAX_DECODED_SIDE = 3000;
/** A new photo starts on hand-trace: auto-trace turns most pencil drawings into blobs. */
const NEW_PHOTO_METHOD: TracingMethod = "hand";

/** What a reload restores a photo with: its cleanup and tone, whether it was in Cleanup, both methods' state, Done. */
export interface KeptTrace {
  cleanup: Cleanup;
  tone: Tone;
  inCleanup: boolean;
  settings: AutoTraceSettings;
  method: TracingMethod;
  accepted: boolean;
}

/** What the trace panel reports. */
export interface TraceHooks {
  /** An auto-trace finished (or failed, or the photo couldn't be read or cleaned up). */
  onTraced(design: Design | null, status: string, failed: boolean): void;
  /** Done or Edit was pressed. */
  onAccepted(): void;
  /** A released change to the cleanup or its tone, or Cleanup was entered or left. */
  onCleanup(): void;
  /** A new cleaned-up photo is ready, at `href`, for a hand-trace to be placed over. */
  onCleaned(href: string): void;
  /** The tracing method switch was flipped (which clears Done). */
  onMethod(): void;
}

export interface TracePanel {
  /**
   * Load a photo and open it in Cleanup on hand-trace; or, with `kept` (a restore after a reload), as it was:
   * in Cleanup or past it, on the method chosen, with its settings and Done.
   */
  load(file: File, kept?: KeptTrace): Promise<void>;
  /** Hide the panel and forget the image (another kind of design was chosen). */
  clear(): void;
  /** An image is loaded (the panel is showing). */
  loaded(): boolean;
  /** The carver pressed Done on the chosen method. Loading a new image or flipping the method switch resets this. */
  accepted(): boolean;
  /** The threshold, invert and speckle settings as they are now. */
  autoTrace(): AutoTraceSettings;
  /** The photo's cleanup as it is now. */
  cleanup(): Cleanup;
  /** Cleanup's tone as it is now. */
  tone(): Tone;
  /** The photo is in Cleanup. */
  inCleanup(): boolean;
  /** The chosen tracing method. */
  method(): TracingMethod;
  /** The design space a hand-trace over the cleaned-up photo is placed in, as the cleanup now makes it. */
  page(): Page;
  /** Where the hand-trace canvas goes in the Photo view: shown past Cleanup while hand-trace is chosen. */
  handSlot: HTMLElement;
}

/**
 * A photo's Cleanup, then the Tracing method switch with auto-trace's threshold, invert and speckle controls and
 * Done. The photo, the cleaned-up photo and the auto-trace result go in `view` (the viewport's Photo view), at
 * viewport size; so does the hand-trace canvas, through `handSlot`. Auto-trace runs only once it's been chosen past
 * Cleanup, and again on a cleanup change only while it's chosen. The image never leaves the browser.
 */
export function mountTracePanel(root: HTMLElement, view: HTMLElement, hooks: TraceHooks): TracePanel {
  root.hidden = true;
  root.classList.add("trace");
  view.classList.add("trace-views");
  view.innerHTML = `
    <figure class="trace-photo"></figure>
    <figure class="trace-cleaned">
      <div class="trace-fit"><div class="cleanup-stack">
        <canvas aria-label="The cleaned-up photo"></canvas>
        <svg class="cleaned-overlay" viewBox="0 0 2 1" preserveAspectRatio="none">
          <line class="symmetry-axis" x1="1" y1="0" x2="1" y2="1" />
        </svg>
      </div></div>
      <figcaption>The cleaned-up photo: what's traced.</figcaption>
    </figure>
    <figure class="trace-result-figure">
      <div class="trace-fit trace-result" role="img" aria-label="Auto-trace result"></div>
      <figcaption>Auto-trace result: black areas are carved.</figcaption>
    </figure>
    <div class="trace-hand-slot" hidden></div>
  `;
  root.innerHTML = `
    <div class="trace-cleanup"></div>
    <div class="trace-tracing">
    <button type="button" class="trace-straighten">Straighten photo</button>
    <fieldset class="field trace-method">
      <legend>Tracing method</legend>
      <div class="chips">
        <label><input type="radio" name="t-method" value="auto" />Auto-trace</label>
        <label><input type="radio" name="t-method" value="hand" />Hand-trace</label>
      </div>
    </fieldset>
    <div class="trace-settings">
    <div class="field">
      <label for="t-threshold">Threshold</label>
      <div class="input-row">
        <input id="t-threshold" type="range" min="${THRESHOLD_RANGE.min}" max="${THRESHOLD_RANGE.max}" step="1" value="${DEFAULTS.threshold}" />
        <output for="t-threshold">${DEFAULTS.threshold}</output>
      </div>
      <div class="hint">Higher carves more of the lighter grays.</div>
    </div>
    <div class="field checkbox">
      <label><input id="t-invert" type="checkbox" /> Invert (white-on-black stencil)</label>
    </div>
    <div class="field">
      <label for="t-speckle">Speckle removal (px)</label>
      <div class="input-row">
        <input id="t-speckle" type="number" min="0" max="${MAX_SPECKLE}" step="1" value="${DEFAULTS.speckle}" />
      </div>
      <div class="hint">Specks up to this many pixels are ignored.</div>
    </div>
    </div>
    <div class="trace-accept-row">
      <button type="button" class="trace-accept">Done</button>
      <div class="hint trace-accepted-note" hidden></div>
    </div>
    </div>
  `;

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const cleanedFigure = view.querySelector<HTMLElement>(".trace-cleaned")!;
  const cleanedStack = cleanedFigure.querySelector<HTMLElement>(".cleanup-stack")!;
  const cleanedCanvas = cleanedFigure.querySelector("canvas")!;
  const cleanedAxis = cleanedFigure.querySelector<SVGSVGElement>("svg")!;
  const photoFigure = view.querySelector<HTMLElement>(".trace-photo")!;
  const resultFigure = view.querySelector<HTMLElement>(".trace-result-figure")!;
  const resultEl = view.querySelector<HTMLElement>(".trace-result")!;
  const handSlot = view.querySelector<HTMLElement>(".trace-hand-slot")!;
  const cleanupEl = $<HTMLElement>(".trace-cleanup");
  const tracingEl = $<HTMLElement>(".trace-tracing");
  const straighten = $<HTMLButtonElement>(".trace-straighten");
  const methods = [...root.querySelectorAll<HTMLInputElement>('input[name="t-method"]')];
  const settingsEl = $<HTMLElement>(".trace-settings");
  const acceptButton = $<HTMLButtonElement>(".trace-accept");
  const acceptedNote = $<HTMLElement>(".trace-accepted-note");
  const threshold = $<HTMLInputElement>("#t-threshold");
  const thresholdOut = $<HTMLOutputElement>(".trace-settings output");
  const invert = $<HTMLInputElement>("#t-invert");
  const speckle = $<HTMLInputElement>("#t-speckle");

  let accepted = false;
  let cleaning = true;
  let method: TracingMethod = NEW_PHOTO_METHOD;

  const warper = startCleanupWarp();
  /** The decoded photo's pixels, which the warp samples. */
  let photoPixels: ImageData | null = null;
  /** The cleaned-up photo, once warped: what auto-trace traces. */
  let cleaned: ImageData | null = null;
  /** The cleaned-up photo auto-trace last ran on: when it's still `cleaned`, its result is up to date. */
  let tracedFrom: ImageData | null = null;
  /** The cleaned-up photo as an image URL, for the hand-trace canvas; revoked once replaced. */
  let cleanedHref: string | null = null;
  let traceId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Show what fits the stage and the method: Cleanup; or past it, auto-trace's result or the hand-trace canvas. */
  const show = () => {
    const auto = method === "auto";
    cleanupEl.hidden = photoFigure.hidden = !cleaning;
    tracingEl.hidden = cleaning;
    cleanedFigure.hidden = !cleaning && !auto;
    resultFigure.hidden = cleaning || !auto;
    handSlot.hidden = cleaning || auto;
    cleanedAxis.toggleAttribute("hidden", !cleaning); // the symmetry axis is always drawn during Cleanup
    // Tone is shown on the cleaned-up photo while it's being set; past Cleanup only the hand-trace's photo has it.
    cleanedCanvas.style.filter = cleaning ? toneFilter(cleanupPanel.tone()) : "";
    for (const m of methods) m.checked = m.value === method;
    settingsEl.hidden = !auto || accepted;
    straighten.hidden = accepted;
    acceptButton.textContent = accepted ? "Edit" : "Done";
    acceptedNote.hidden = !accepted;
    acceptedNote.textContent = auto
      ? "Auto-trace accepted. Pick Photo above the preview to see it again."
      : "Hand-trace done. Pick Photo above the preview to see it again.";
  };

  /** Auto-trace is chosen past Cleanup: trace now unless its result is already for this cleaned-up photo. */
  const traceIfShown = () => {
    if (!cleaning && method === "auto" && tracedFrom !== cleaned) void retrace();
  };

  const cleanupPanel = mountCleanupPanel(
    cleanupEl,
    photoFigure,
    () => {
      void rewarp();
      hooks.onCleanup();
    },
    () => {
      cleaning = false;
      show();
      traceIfShown();
      hooks.onCleanup();
    },
    (live) => {
      show();
      if (!live) hooks.onCleanup();
    },
  );

  acceptButton.addEventListener("click", () => {
    accepted = !accepted;
    show();
    hooks.onAccepted();
  });
  for (const m of methods)
    m.addEventListener("change", () => {
      if (!m.checked) return;
      method = m.value as TracingMethod;
      accepted = false;
      show();
      traceIfShown();
      hooks.onMethod();
    });
  straighten.addEventListener("click", () => {
    cleaning = true;
    show();
    hooks.onCleanup();
  });

  /** Warp the photo for the cleanup as it now is; trace it again if auto-trace's side is shown. */
  async function rewarp(): Promise<void> {
    if (!photoPixels) return;
    const next = cleanupPanel.cleanedUp();
    try {
      const pixels = await warper.warp(photoPixels, next);
      if (!pixels || !photoPixels) return; // a newer warp is coming, or the photo is gone
      cleaned = pixels;
      cleanedCanvas.width = pixels.width;
      cleanedCanvas.height = pixels.height;
      cleanedCanvas.getContext("2d")!.putImageData(pixels, 0, 0);
      cleanedStack.style.setProperty("--aspect", String(pixels.width / pixels.height));
      cleanedAxis.setAttribute("viewBox", `0 0 ${pixels.width} ${pixels.height}`);
      cleanedAxis.querySelector("line")!.setAttribute("x1", String(pixels.width / 2));
      cleanedAxis.querySelector("line")!.setAttribute("x2", String(pixels.width / 2));
      cleanedAxis.querySelector("line")!.setAttribute("y2", String(pixels.height));
      handOver(pixels);
      traceIfShown();
    } catch (err) {
      hooks.onTraced(null, `The photo couldn't be cleaned up: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** Hand the cleaned-up photo to the hand-trace canvas as an image URL. */
  function handOver(pixels: ImageData): void {
    cleanedCanvas.toBlob((blob) => {
      if (!blob || pixels !== cleaned) return; // a newer cleaned-up photo, or none, since
      const old = cleanedHref;
      cleanedHref = URL.createObjectURL(blob);
      hooks.onCleaned(cleanedHref);
      if (old) URL.revokeObjectURL(old);
    });
  }

  const autoTrace = (): AutoTraceSettings => ({
    threshold: Number(threshold.value),
    invert: invert.checked,
    speckle: Number(speckle.value) || 0,
  });

  async function retrace(): Promise<void> {
    if (!cleaned) return; // traced once the warp lands
    const id = ++traceId;
    const from = cleaned;
    try {
      const { traceImage } = await import("../input/traceImage"); // Potrace loads only when needed
      const result = await traceImage(from, autoTrace());
      if (id !== traceId) return;
      tracedFrom = from;
      resultEl.innerHTML = result.svg;
      fitAspect(resultEl.querySelector("svg"));
      const count = result.design
        ? `${result.design.paths.length} shape${result.design.paths.length === 1 ? "" : "s"} auto-traced.`
        : "";
      hooks.onTraced(result.design, [count, ...result.notes].filter(Boolean).join(" "), result.design === null);
    } catch (err) {
      if (id !== traceId) return;
      resultEl.replaceChildren();
      hooks.onTraced(null, `Auto-trace failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }
  const scheduleRetrace = () => {
    clearTimeout(timer);
    timer = setTimeout(retrace, RETRACE_DELAY_MS);
  };

  threshold.addEventListener("input", () => {
    thresholdOut.value = threshold.value;
    scheduleRetrace();
  });
  invert.addEventListener("change", scheduleRetrace);
  speckle.addEventListener("input", scheduleRetrace);

  /** Give the CSS the element's width/height ratio, so it can scale the element to fit its figure. */
  function fitAspect(el: Element | null): void {
    if (!(el instanceof SVGSVGElement)) return;
    const [w, h] = [Number.parseFloat(el.getAttribute("width") ?? ""), Number.parseFloat(el.getAttribute("height") ?? "")];
    if (w > 0 && h > 0) el.style.setProperty("--aspect", String(w / h));
  }

  /** Forget the loaded photo and anything traced from it. */
  const forget = () => {
    clearTimeout(timer);
    traceId++;
    [photoPixels, cleaned, tracedFrom] = [null, null, null];
    if (cleanedHref) URL.revokeObjectURL(cleanedHref);
    cleanedHref = null;
    resultEl.replaceChildren();
    [accepted, cleaning, method] = [false, true, NEW_PHOTO_METHOD];
  };

  return {
    async load(file, kept) {
      forget();
      const settings = kept?.settings ?? DEFAULTS;
      threshold.value = thresholdOut.value = String(settings.threshold);
      invert.checked = settings.invert;
      speckle.value = String(settings.speckle);
      let photo: ImageBitmap;
      try {
        photo = await decode(file);
      } catch {
        root.hidden = true;
        hooks.onTraced(null, "This image couldn't be read.", true);
        return;
      }
      const focal = exifFocal35Mm(await file.arrayBuffer());
      photoPixels = pixelsOf(photo);
      root.hidden = false;
      cleanupPanel.show(photo, kept?.cleanup ?? { corners: START_FRAME, aspect: null }, kept?.tone ?? TONE_DEFAULTS, focal);
      photo.close();
      if (kept) [cleaning, method, accepted] = [kept.inCleanup, kept.method, kept.accepted];
      show();
      await rewarp();
    },
    clear() {
      forget();
      root.hidden = true;
    },
    loaded: () => !root.hidden,
    accepted: () => accepted,
    autoTrace,
    cleanup: () => cleanupPanel.cleanup(),
    tone: () => cleanupPanel.tone(),
    inCleanup: () => cleaning,
    method: () => method,
    page: () => photoPage(cleanupPanel.cleanedUp()),
    handSlot,
  };
}

/** The photo decoded the right way up (EXIF orientation), shrunk to `MAX_DECODED_SIDE` with the browser's best filter. */
async function decode(file: File): Promise<ImageBitmap> {
  const full = await createImageBitmap(file);
  const size = fitWithin(full.width, full.height, MAX_DECODED_SIDE);
  if (size.width === full.width && size.height === full.height) return full;
  try {
    return await createImageBitmap(full, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" });
  } finally {
    full.close();
  }
}

/** A decoded photo's RGBA pixels. */
function pixelsOf(photo: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(photo.width, photo.height);
  const g = canvas.getContext("2d")!;
  g.drawImage(photo, 0, 0);
  return g.getImageData(0, 0, photo.width, photo.height);
}
