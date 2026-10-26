import type { Design } from "../core";
import { AUTO_TRACE_DEFAULTS as DEFAULTS, MAX_SPECKLE, THRESHOLD_RANGE, type AutoTraceSettings } from "../designRecord";
import { exifFocal35Mm, START_FRAME, type Cleanup } from "../input/cleanupFrame";
import { fitWithin } from "../input/rasterPrep";
import { startCleanupWarp } from "../worker/cleanupWarp";
import { mountCleanupPanel } from "./cleanupPanel";

const RETRACE_DELAY_MS = 150;
/**
 * The photo's long side once decoded, in px (shrunk with the browser's high-quality filter): a sheet filling two
 * thirds of the photo still gets the cleaned-up photo's 2000 px, and the warp never shrinks much, which it does
 * poorly.
 */
const MAX_DECODED_SIDE = 3000;

/** What a reload restores a photo with: its cleanup, auto-trace's settings and Done. */
export interface KeptTrace {
  cleanup: Cleanup;
  settings: AutoTraceSettings;
  accepted: boolean;
}

export interface TracePanel {
  /**
   * Load a photo and open it in Cleanup; or, with `kept` (a restore after a reload), auto-trace it at once with the
   * cleanup, settings and Done as they were.
   */
  load(file: File, kept?: KeptTrace): Promise<void>;
  /** Hide the panel and forget the image (another kind of design was chosen). */
  clear(): void;
  /** An image is loaded (the panel is showing). */
  loaded(): boolean;
  /** The carver accepted the trace: done tuning it. Loading a new image resets this. */
  accepted(): boolean;
  /** The threshold, invert and speckle settings as they are now. */
  autoTrace(): AutoTraceSettings;
  /** The photo's cleanup as it is now. */
  cleanup(): Cleanup;
}

/**
 * A photo's Cleanup, then auto-trace's threshold, invert and speckle controls. The photo, the cleaned-up photo and
 * the auto-trace result go in `view` (the viewport's Photo view), at viewport size. Every finished trace is reported
 * through `onTraced`; accepting the trace, or going back to adjust it, through `onAccepted`; each released cleanup
 * change through `onCleanup`. The image never leaves the browser.
 */
export function mountTracePanel(
  root: HTMLElement,
  onTraced: (design: Design | null, status: string, failed: boolean) => void,
  view: HTMLElement,
  onAccepted: () => void,
  onCleanup: () => void,
): TracePanel {
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
  `;
  root.innerHTML = `
    <div class="trace-cleanup"></div>
    <div class="trace-tracing">
    <button type="button" class="trace-straighten">Straighten photo</button>
    <h3>Tracing method</h3>
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
      <div class="hint trace-accepted-note" hidden>Auto-trace accepted. Pick Photo above the preview to see it again.</div>
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
  const cleanupEl = $<HTMLElement>(".trace-cleanup");
  const tracingEl = $<HTMLElement>(".trace-tracing");
  const straighten = $<HTMLButtonElement>(".trace-straighten");
  const settingsEl = $<HTMLElement>(".trace-settings");
  const acceptButton = $<HTMLButtonElement>(".trace-accept");
  const acceptedNote = $<HTMLElement>(".trace-accepted-note");
  let accepted = false;
  const setAccepted = (next: boolean) => {
    accepted = next;
    settingsEl.hidden = next;
    acceptedNote.hidden = !next;
    straighten.hidden = next;
    acceptButton.textContent = next ? "Edit" : "Done";
  };
  acceptButton.addEventListener("click", () => {
    setAccepted(!accepted);
    onAccepted();
  });
  const threshold = $<HTMLInputElement>("#t-threshold");
  const thresholdOut = $<HTMLOutputElement>(".trace-settings output");
  const invert = $<HTMLInputElement>("#t-invert");
  const speckle = $<HTMLInputElement>("#t-speckle");

  const warper = startCleanupWarp();
  /** The decoded photo's pixels, which the warp samples. */
  let photoPixels: ImageData | null = null;
  /** The cleaned-up photo, once warped: what auto-trace traces. */
  let cleaned: ImageData | null = null;
  /** Auto-trace has run on this photo: from then on, each new cleaned-up photo is traced again. */
  let traced = false;
  let traceId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Show Cleanup, or auto-trace past it. */
  const showStage = (cleanup: boolean) => {
    cleanupEl.hidden = photoFigure.hidden = !cleanup;
    tracingEl.hidden = resultFigure.hidden = cleanup;
    cleanedAxis.toggleAttribute("hidden", !cleanup); // the symmetry axis is always drawn during Cleanup
  };

  const cleanupPanel = mountCleanupPanel(
    cleanupEl,
    photoFigure,
    () => {
      void rewarp();
      onCleanup();
    },
    () => {
      showStage(false);
      traced = true;
      void retrace();
    },
  );

  /** Warp the photo for the cleanup as it now is; trace it again once auto-trace has run. */
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
      if (traced) await retrace();
    } catch (err) {
      onTraced(null, `The photo couldn't be cleaned up: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  const autoTrace = (): AutoTraceSettings => ({
    threshold: Number(threshold.value),
    invert: invert.checked,
    speckle: Number(speckle.value) || 0,
  });

  async function retrace(): Promise<void> {
    if (!cleaned) return; // traced once the warp lands
    const id = ++traceId;
    try {
      const { traceImage } = await import("../input/traceImage"); // Potrace loads only when needed
      const result = await traceImage(cleaned, autoTrace());
      if (id !== traceId) return;
      resultEl.innerHTML = result.svg;
      fitAspect(resultEl.querySelector("svg"));
      const count = result.design
        ? `${result.design.paths.length} shape${result.design.paths.length === 1 ? "" : "s"} auto-traced.`
        : "";
      onTraced(result.design, [count, ...result.notes].filter(Boolean).join(" "), result.design === null);
    } catch (err) {
      if (id !== traceId) return;
      resultEl.replaceChildren();
      onTraced(null, `Auto-trace failed: ${err instanceof Error ? err.message : String(err)}`, true);
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
  straighten.addEventListener("click", () => showStage(true));

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
    [photoPixels, cleaned, traced] = [null, null, false];
    resultEl.replaceChildren();
    setAccepted(false);
  };

  return {
    async load(file, kept) {
      forget();
      if (kept) {
        threshold.value = thresholdOut.value = String(kept.settings.threshold);
        invert.checked = kept.settings.invert;
        speckle.value = String(kept.settings.speckle);
      }
      let photo: ImageBitmap;
      try {
        photo = await decode(file);
      } catch {
        root.hidden = true;
        onTraced(null, "This image couldn't be read.", true);
        return;
      }
      const focal = exifFocal35Mm(await file.arrayBuffer());
      photoPixels = pixelsOf(photo);
      root.hidden = false;
      cleanupPanel.show(photo, kept?.cleanup ?? { corners: START_FRAME, aspect: null }, focal);
      photo.close();
      showStage(!kept);
      traced = Boolean(kept);
      await rewarp();
      if (kept) setAccepted(kept.accepted);
    },
    clear() {
      forget();
      root.hidden = true;
    },
    loaded: () => !root.hidden,
    accepted: () => accepted,
    autoTrace,
    cleanup: () => cleanupPanel.cleanup(),
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
