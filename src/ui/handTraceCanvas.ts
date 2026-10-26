import type { TemplateWarning } from "../core";
import {
  createGestureRecognizer,
  createHandTrace,
  type Drawn,
  type Gesture,
  type HandTrace,
  type HandTraceRecord,
  HOLD_MS,
  type Loupe,
  type Page,
  type PointerInput,
} from "../handTrace";
import { designFromPathData } from "../input/pathDesign";
import { el } from "./svg";

export interface HandTraceCanvas {
  /** Start a new hand-trace on a blank page, replacing any other; or reopen a `kept` one, as after a reload. */
  startBlankPage(kept?: { page: Page; handTrace: HandTraceRecord }): void;
  /** Forget the hand-trace (another design was loaded). */
  clear(): void;
  /** The hand-trace being shown, or null when there's none. */
  editor(): HandTrace | null;
  /** Done (true) or Edit (false): hide the tools and stop taking input, or bring them back. */
  setDone(done: boolean): void;
  /** The core's warnings for the hand-trace's Design: its shape warnings are marked where they are. */
  showWarnings(warnings: readonly TemplateWarning[]): void;
}

/** Grid lines across the blank page, each way: faint, so pan and zoom show. */
const GRID_DIVISIONS = 10;
/** Drawn sizes in screen px. */
const POINT_HALF_PX = 5;
const END_RING_PX = 9;
const CLOSE_RING_PX = 12;
/** Half the insert marker's diagonal. */
const MARKER_HALF_PX = 5;
/** The ring round a crossing: small, so it doesn't hide the edges it marks. */
const CROSSING_RING_PX = 7;
/** Room between a tiny carve area and its ring, and the least ring, so a speck's ring still shows. */
const TINY_RING_GAP_PX = 4;
const TINY_RING_MIN_PX = 10;
/** Decimals kept in screen coordinates. */
const DECIMALS = 1;
/** Canvases mounted so far, to give each drawing its own id. */
let canvases = 0;

/**
 * The hand-trace canvas in the Page view: draws what the editor says is drawn, in SVG, and forwards pointer and
 * wheel events to it through the gesture recognizer. Calls `onChange` after each finished change to the shapes
 * (the editor's `Design` is a new object then), never mid-drag, and `onKeep` after each change to its stored record
 * (those plus ending a shape open, Done and Edit). Every decision is the editor's.
 */
export function mountHandTraceCanvas(view: HTMLElement, onChange: () => void, onKeep: () => void): HandTraceCanvas {
  view.classList.add("hand-trace");
  view.innerHTML = `
    <svg class="ht-svg" role="img" aria-label="Blank page. Tap or click to place points or select them, or touch and hold to aim one with the loupe; drag a point to move it, or empty space to pan; pinch or scroll to zoom; tap with two fingers to undo, three to redo."></svg>
    <div class="ht-tools">
      <div class="ht-top-left">
        <button type="button" data-act="undo">Undo</button>
        <button type="button" data-act="redo">Redo</button>
      </div>
      <div class="ht-top-right"><button type="button" data-act="clear">Clear</button></div>
      <div class="ht-bottom">
        <div class="ht-note" hidden></div>
        <div class="ht-pill" aria-live="polite"></div>
      </div>
    </div>
  `;
  const svg = view.querySelector<SVGSVGElement>(".ht-svg")!;
  const tools = view.querySelector<HTMLElement>(".ht-tools")!;
  const note = view.querySelector<HTMLElement>(".ht-note")!;
  const pill = view.querySelector<HTMLElement>(".ht-pill")!;
  const button = (act: string) => tools.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
  let editor: HandTrace | null = null;
  let recognizer = createGestureRecognizer();
  /** The drawing's id, for the loupe to show it by reference; one per canvas. */
  const drawingId = `ht-drawing-${++canvases}`;
  /** The Design last reported through `onChange`, to tell when a change finished. */
  let reported: unknown = null;
  /** The stored record last reported through `onKeep`. */
  let kept: unknown = null;

  /** Draw the editor's state, and report the Design (and the record) if a change to the shapes finished. */
  const render = () => {
    if (!editor) return svg.replaceChildren();
    const drawn = editor.drawn();
    draw(svg, drawn, drawingId);
    tools.hidden = !drawn.tools;
    svg.classList.toggle("ht-done", !drawn.tools);
    button("undo").disabled = !drawn.can.undo;
    button("redo").disabled = !drawn.can.redo;
    button("clear").disabled = !drawn.can.clear;
    note.hidden = drawn.note === null;
    note.textContent = drawn.note ?? "";
    renderPill(drawn);
    const design = editor.design();
    if (design !== reported) {
      reported = design;
      onChange();
    }
    const record = editor.record();
    if (record !== kept) {
      kept = record;
      onKeep();
    }
  };

  const renderPill = ({ pill: state }: Drawn) => {
    if (state.kind === "hint") return void (pill.textContent = state.text);
    if (state.kind === "drawing") {
      const count = document.createElement("span");
      count.textContent = `${state.points} point${state.points === 1 ? "" : "s"}`;
      const close = pillButton("close", "Close");
      close.disabled = !state.canClose;
      return pill.replaceChildren(count, close, pillButton("end", "End"));
    }
    // Never "Done": that belongs to the loaded design.
    const deselect = pillButton("clearSelection", "✕");
    deselect.title = "Clear selection";
    deselect.setAttribute("aria-label", "Clear selection");
    if (state.kind === "shape") return pill.replaceChildren(pillButton("delete", "Delete shape"), deselect);
    const carry = state.canCarryOn ? [pillButton("carryOn", "Carry on")] : [];
    pill.replaceChildren(pillButton("delete", "Delete point"), ...carry, deselect);
  };

  /** The editor commands the overlay's buttons press, by their `data-act`. */
  const ACTS = ["undo", "redo", "clear", "close", "end", "delete", "carryOn", "clearSelection"] as const;
  tools.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
    const command = ACTS.find((a) => a === act);
    if (!editor || !command) return;
    editor[command]();
    render();
  });

  const input = (e: PointerEvent): PointerInput => {
    const r = svg.getBoundingClientRect();
    const pointerType = e.pointerType === "mouse" || e.pointerType === "pen" ? e.pointerType : "touch";
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, pointerType, button: e.button };
  };
  const forward = (gestures: Gesture[]) => {
    if (!editor || gestures.length === 0) return;
    for (const g of gestures) editor.gesture(g);
    render();
  };
  svg.addEventListener("pointerdown", (e) => {
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // A scripted pointer (checking by hand) can't be captured; it still counts.
    }
    forward(recognizer.down(input(e)));
    // The recognizer keeps no timers: tell it when a hold may be due (`timeStamp` and `now` share a clock).
    window.setTimeout(() => forward(recognizer.tick(performance.now())), HOLD_MS);
  });
  // A long press would otherwise open the browser's menu over the canvas.
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  svg.addEventListener("pointermove", (e) => forward(recognizer.move(input(e))));
  svg.addEventListener("pointerup", (e) => forward(recognizer.up(input(e))));
  svg.addEventListener("pointercancel", (e) => forward(recognizer.cancel(input(e))));
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      forward(recognizer.wheel({ x: e.clientX - r.left, y: e.clientY - r.top, deltaY: e.deltaY }));
    },
    { passive: false },
  );
  new ResizeObserver(() => {
    const r = svg.getBoundingClientRect();
    editor?.resize(r.width, r.height);
    render();
  }).observe(svg);

  return {
    startBlankPage(restored) {
      editor = createHandTrace({ toDesign: designFromPathData, page: restored?.page, record: restored?.handTrace });
      recognizer = createGestureRecognizer();
      reported = editor.design();
      kept = editor.record();
      const r = svg.getBoundingClientRect();
      editor.resize(r.width, r.height);
      render();
    },
    clear() {
      editor = null;
      reported = null;
      render();
    },
    editor: () => editor,
    setDone(done) {
      if (done) editor?.done();
      else editor?.edit();
      render();
    },
    showWarnings(warnings) {
      if (!editor) return;
      editor.showWarnings(warnings);
      draw(svg, editor.drawn(), drawingId);
    },
  };
}

/** A pill button that presses editor command `act`. */
function pillButton(act: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.act = act;
  b.textContent = text;
  return b;
}

/** Draw the page, the shapes and their points into a group with `id`, and the loupe over them. */
function draw(svg: SVGSVGElement, drawn: Drawn, id: string): void {
  const { page, axis } = drawn;
  const parts: SVGElement[] = [el("rect", { class: "ht-page", ...page }, DECIMALS)];
  for (let i = 1; i < GRID_DIVISIONS; i++) {
    const [x, y] = [page.x + (page.width * i) / GRID_DIVISIONS, page.y + (page.height * i) / GRID_DIVISIONS];
    parts.push(el("line", { class: "ht-grid", x1: x, y1: page.y, x2: x, y2: page.y + page.height }, DECIMALS));
    parts.push(el("line", { class: "ht-grid", x1: page.x, y1: y, x2: page.x + page.width, y2: y }, DECIMALS));
  }
  parts.push(el("line", { class: "ht-axis", x1: axis.from.x, y1: axis.from.y, x2: axis.to.x, y2: axis.to.y }, DECIMALS));
  if (drawn.fill) parts.push(el("path", { class: "ht-fill", d: drawn.fill }));
  const { warnings } = drawn;
  for (const d of warnings.floating) parts.push(el("path", { class: "ht-warn-tint", d }));
  for (const shape of drawn.shapes) {
    const cls = ["ht-line", !shape.closed && "open", shape.drawing && "drawing", shape.selected && "selected"]
      .filter(Boolean)
      .join(" ");
    parts.push(el("path", { class: cls, d: shape.d }));
  }
  // Over the lines they mark, under the points so those stay plain to see.
  for (const { x, y } of warnings.crossings) {
    parts.push(el("circle", { class: "ht-warn-ring", cx: x, cy: y, r: CROSSING_RING_PX }, DECIMALS));
  }
  for (const { at, r } of warnings.tiny) {
    const radius = Math.max(r + TINY_RING_GAP_PX, TINY_RING_MIN_PX);
    parts.push(el("circle", { class: "ht-warn-ring", cx: at.x, cy: at.y, r: radius }, DECIMALS));
  }
  for (const p of drawn.points) {
    const { x, y } = p.at;
    if (p.closable) parts.push(el("circle", { class: "ht-close-ring", cx: x, cy: y, r: CLOSE_RING_PX }, DECIMALS));
    if (p.end) parts.push(el("circle", { class: "ht-end", cx: x, cy: y, r: END_RING_PX }, DECIMALS));
    const half = POINT_HALF_PX;
    const cls = p.selected ? "ht-point selected" : "ht-point";
    parts.push(
      p.kind === "smooth"
        ? el("circle", { class: cls, cx: x, cy: y, r: half }, DECIMALS)
        : el("rect", { class: cls, x: x - half, y: y - half, width: 2 * half, height: 2 * half }, DECIMALS),
    );
  }
  for (const { x, y } of drawn.markers) {
    const h = MARKER_HALF_PX / Math.SQRT2;
    const transform = `rotate(45 ${x.toFixed(DECIMALS)} ${y.toFixed(DECIMALS)})`;
    const square = { x: x - h, y: y - h, width: 2 * h, height: 2 * h };
    parts.push(el("rect", { class: "ht-marker", ...square, transform }, DECIMALS));
  }
  const drawing = el("g", { id });
  drawing.replaceChildren(...parts);
  svg.replaceChildren(drawing, ...(drawn.loupe ? [loupeOf(drawn.loupe, id)] : []));
}

/**
 * The loupe: a circle showing the drawing (by reference, as drawn) magnified about its focus, with a crosshair
 * where the point lands. Its points and markers are drawn faint so they don't hide the line under them.
 */
function loupeOf({ box, focus, magnification }: Loupe, drawingId: string): SVGElement {
  const span = box.width / magnification;
  const [x0, y0] = [focus.x - span / 2, focus.y - span / 2];
  const lens = el("svg", { class: "ht-loupe", ...box, viewBox: `${x0} ${y0} ${span} ${span}` });
  const clip = `${drawingId}-loupe`;
  const clipPath = el("clipPath", { id: clip });
  clipPath.append(el("circle", { cx: focus.x, cy: focus.y, r: span / 2 }));
  const view = el("g", { "clip-path": `url(#${clip})` });
  view.append(
    el("circle", { class: "ht-loupe-back", cx: focus.x, cy: focus.y, r: span / 2 }),
    el("use", { href: `#${drawingId}` }),
    el("line", { class: "ht-loupe-cross", x1: x0, y1: focus.y, x2: x0 + span, y2: focus.y }),
    el("line", { class: "ht-loupe-cross", x1: focus.x, y1: y0, x2: focus.x, y2: y0 + span }),
  );
  lens.append(clipPath, view, el("circle", { class: "ht-loupe-rim", cx: focus.x, cy: focus.y, r: span / 2 }));
  return lens;
}
