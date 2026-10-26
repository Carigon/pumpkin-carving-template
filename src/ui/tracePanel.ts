import type { Design } from "../core";
import type { PixelRect } from "../input/rasterPrep";
import type { TraceSettings } from "../input/traceImage";

const RETRACE_DELAY_MS = 150;
const DEFAULTS = { threshold: 128, invert: false, speckle: 2 };

export interface TracePanel {
  /** Load a scanned stencil or photo and trace it with the current settings. */
  load(file: File): Promise<void>;
  /** Hide the panel and forget the image (another kind of design was chosen). */
  clear(): void;
  /** An image is loaded (the panel is showing). */
  loaded(): boolean;
  /** The carver accepted the trace: done tuning it. Loading a new image resets this. */
  accepted(): boolean;
}

/**
 * Crop, threshold, invert and speckle controls for a raster image. The crop image and the auto-trace result go
 * in `view` (the viewport's Photo view), at viewport size. Every finished trace is reported through
 * `onTraced`; accepting the trace, or going back to adjust it, through `onAccepted`. The image never leaves
 * the browser.
 */
export function mountTracePanel(
  root: HTMLElement,
  onTraced: (design: Design | null, status: string, failed: boolean) => void,
  view: HTMLElement,
  onAccepted: () => void,
): TracePanel {
  root.hidden = true;
  root.classList.add("trace");
  view.classList.add("trace-views");
  view.innerHTML = `
    <figure>
      <div class="trace-fit"><canvas class="trace-crop" aria-label="Scanned image. Drag to crop."></canvas></div>
      <figcaption>Drag on the image to crop. <button type="button" class="trace-reset">Use whole image</button></figcaption>
    </figure>
    <figure>
      <div class="trace-fit trace-result" role="img" aria-label="Auto-trace result"></div>
      <figcaption>Auto-trace result: black areas are carved.</figcaption>
    </figure>
  `;
  root.innerHTML = `
    <h3>Tracing method</h3>
    <div class="trace-settings">
    <div class="field">
      <label for="t-threshold">Threshold</label>
      <div class="input-row">
        <input id="t-threshold" type="range" min="1" max="254" step="1" value="${DEFAULTS.threshold}" />
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
        <input id="t-speckle" type="number" min="0" max="1000" step="1" value="${DEFAULTS.speckle}" />
      </div>
      <div class="hint">Specks up to this many pixels are ignored.</div>
    </div>
    </div>
    <div class="trace-accept-row">
      <button type="button" class="trace-accept">Done</button>
      <div class="hint trace-accepted-note" hidden>Auto-trace accepted. Pick Photo above the preview to see it again.</div>
    </div>
  `;

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const cropCanvas = view.querySelector<HTMLCanvasElement>(".trace-crop")!;
  const resultEl = view.querySelector<HTMLElement>(".trace-result")!;
  const settingsEl = $<HTMLElement>(".trace-settings");
  const acceptButton = $<HTMLButtonElement>(".trace-accept");
  const acceptedNote = $<HTMLElement>(".trace-accepted-note");
  let accepted = false;
  const setAccepted = (next: boolean) => {
    accepted = next;
    settingsEl.hidden = next;
    acceptedNote.hidden = !next;
    acceptButton.textContent = next ? "Edit" : "Done";
  };
  acceptButton.addEventListener("click", () => {
    setAccepted(!accepted);
    onAccepted();
  });
  const threshold = $<HTMLInputElement>("#t-threshold");
  const thresholdOut = $<HTMLOutputElement>("output");
  const invert = $<HTMLInputElement>("#t-invert");
  const speckle = $<HTMLInputElement>("#t-speckle");

  let image: ImageBitmap | null = null;
  let crop: PixelRect | undefined;
  let traceId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settings = (): TraceSettings => ({
    threshold: Number(threshold.value),
    invert: invert.checked,
    speckle: Number(speckle.value) || 0,
    crop,
  });

  async function retrace(): Promise<void> {
    if (!image) return;
    const id = ++traceId;
    try {
      const { traceImage } = await import("../input/traceImage"); // Potrace loads only when needed
      const result = await traceImage(image, settings());
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
  view.querySelector<HTMLButtonElement>(".trace-reset")!.addEventListener("click", () => {
    crop = undefined;
    drawCrop();
    scheduleRetrace();
  });

  // Crop by dragging a rectangle on the image; kept in source-image pixels.
  let dragFrom: { x: number; y: number } | null = null;
  const toImage = (e: PointerEvent) => {
    const r = cropCanvas.getBoundingClientRect();
    const sx = image!.width / r.width;
    const sy = image!.height / r.height;
    return {
      x: Math.min(image!.width, Math.max(0, (e.clientX - r.left) * sx)),
      y: Math.min(image!.height, Math.max(0, (e.clientY - r.top) * sy)),
    };
  };
  cropCanvas.addEventListener("pointerdown", (e) => {
    if (!image) return;
    cropCanvas.setPointerCapture(e.pointerId);
    dragFrom = toImage(e);
  });
  cropCanvas.addEventListener("pointermove", (e) => {
    if (!dragFrom) return;
    const p = toImage(e);
    crop = {
      x: Math.min(dragFrom.x, p.x),
      y: Math.min(dragFrom.y, p.y),
      width: Math.abs(p.x - dragFrom.x),
      height: Math.abs(p.y - dragFrom.y),
    };
    drawCrop();
  });
  const endDrag = () => {
    if (!dragFrom) return;
    dragFrom = null;
    if (crop && (crop.width < 4 || crop.height < 4)) crop = undefined; // a click, not a drag
    drawCrop();
    scheduleRetrace();
  };
  cropCanvas.addEventListener("pointerup", endDrag);
  cropCanvas.addEventListener("pointercancel", endDrag);

  /** Give the CSS the element's width/height ratio, so it can scale the element to fit its figure. */
  function fitAspect(el: Element | null): void {
    if (!(el instanceof HTMLCanvasElement || el instanceof SVGSVGElement)) return;
    const [w, h] =
      el instanceof HTMLCanvasElement
        ? [el.width, el.height]
        : [Number.parseFloat(el.getAttribute("width") ?? ""), Number.parseFloat(el.getAttribute("height") ?? "")];
    if (w > 0 && h > 0) el.style.setProperty("--aspect", String(w / h));
  }

  function drawCrop(): void {
    if (!image) return;
    const g = cropCanvas.getContext("2d")!;
    g.drawImage(image, 0, 0, cropCanvas.width, cropCanvas.height);
    if (!crop) return;
    const k = cropCanvas.width / image.width;
    const [x, y, w, h] = [crop.x * k, crop.y * k, crop.width * k, crop.height * k];
    g.fillStyle = "rgba(0, 0, 0, 0.45)";
    g.fillRect(0, 0, cropCanvas.width, y);
    g.fillRect(0, y + h, cropCanvas.width, cropCanvas.height - y - h);
    g.fillRect(0, y, x, h);
    g.fillRect(x + w, y, cropCanvas.width - x - w, h);
    g.strokeStyle = "#e07b00";
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
  }

  return {
    async load(file) {
      clearTimeout(timer);
      image?.close();
      image = null;
      crop = undefined;
      setAccepted(false);
      try {
        image = await createImageBitmap(file);
      } catch {
        root.hidden = true;
        onTraced(null, "This image couldn't be read.", true);
        return;
      }
      root.hidden = false;
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
      cropCanvas.width = Math.max(1, Math.round(image.width * scale));
      cropCanvas.height = Math.max(1, Math.round(image.height * scale));
      fitAspect(cropCanvas);
      drawCrop();
      resultEl.replaceChildren();
      await retrace();
    },
    clear() {
      clearTimeout(timer);
      traceId++;
      image?.close();
      image = null;
      crop = undefined;
      resultEl.replaceChildren();
      root.hidden = true;
      setAccepted(false);
    },
    loaded: () => !root.hidden,
    accepted: () => accepted,
  };
}
