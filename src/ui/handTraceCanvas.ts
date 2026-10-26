import type { TemplateWarning } from "../core";
import {
  createGestureRecognizer,
  createHandTrace,
  type Drawn,
  type Gesture,
  type HandTrace,
  type HandTraceOptions,
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
  /**
   * Start a new hand-trace over a cleaned-up photo whose design space is `page`, replacing any other; or reopen a
   * `kept` one. The photo itself comes through `setPhoto`.
   */
  startPhoto(page: Page, kept?: HandTraceRecord): void;
  /** The cleaned-up photo to place points over (an image URL), shown at the page; null shows none. */
  setPhoto(href: string | null): void;
  /** Cleanup's tone, as a CSS filter on the photo: display only. */
  setTone(filter: string): void;
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
/** A handle's knob at its tip: the selected point's (and stubs'), and its neighbours' smaller. */
const HANDLE_PX = 4.5;
const NEIGHBOUR_HANDLE_PX = 3;
/** The ring round a crossing: small, so it doesn't hide the edges it marks. */
const CROSSING_RING_PX = 7;
/** Room between a tiny carve area and its ring, and the least ring, so a speck's ring still shows. */
const TINY_RING_GAP_PX = 4;
const TINY_RING_MIN_PX = 10;
/** The ring round the point or insert marker a click would act on. */
const HOVER_RING_PX = 10;
/** Decimals kept in screen coordinates. */
const DECIMALS = 1;
/** How the canvas is used, for its accessible label after what it shows. */
const GESTURES_LABEL =
  "Tap or click to place points or select them, or touch and hold to aim one with the loupe; drag a point or handle to move it, or empty space to pan (Space + drag or a middle-button drag pans from anywhere); double-tap a point to make it smooth or a corner; Alt + drag a smooth point's handle to make it a corner; pinch or scroll to zoom; tap with two fingers to undo, three to redo. Keys: Enter closes or carries on, Escape backs out, Delete deletes, Backspace takes off the last point, S switches Smooth / Corner, M switches Symmetry, the arrows nudge, + − and 0 zoom.";
/** How the keys' modifier is written in tooltips: Cmd on Apple devices, Ctrl elsewhere. */
const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
/** Canvases mounted so far, to give each drawing its own id. */
let canvases = 0;

/**
 * The hand-trace canvas, in the Page view or over the cleaned-up photo in the Photo view: draws what the editor says is drawn, in SVG, and forwards pointer and
 * wheel events to it through the gesture recognizer. Calls `onChange` after each finished change to the shapes
 * (the editor's `Design` is a new object then), never mid-drag, and `onKeep` after each change to its stored record
 * (those plus ending a shape open, Done and Edit). Every decision is the editor's.
 */
export function mountHandTraceCanvas(view: HTMLElement, onChange: () => void, onKeep: () => void): HandTraceCanvas {
  view.classList.add("hand-trace");
  view.innerHTML = `
    <svg class="ht-svg" tabindex="0" role="img" aria-label="Blank page. ${GESTURES_LABEL}"></svg>
    <div class="ht-tools">
      <div class="ht-top-left">
        <button type="button" data-act="undo" title="Undo (${MOD}Z)">Undo</button>
        <button type="button" data-act="redo" title="Redo (${MOD}Shift+Z)">Redo</button>
      </div>
      <div class="ht-top-right">
        <button type="button" data-act="toggleSymmetry" title="Symmetry (M)" aria-pressed="false">Symmetry</button>
        <button type="button" data-act="clear">Clear</button>
      </div>
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
  /** The cleaned-up photo, one element for good: drawing it again never reloads the image. */
  const photo = el("image", { class: "ht-photo", preserveAspectRatio: "none" });

  /** Draw the editor's state, and report the Design (and the record) if a change to the shapes finished. */
  const render = () => {
    if (!editor) return svg.replaceChildren();
    const drawn = editor.drawn();
    draw(svg, drawn, drawingId, photo);
    svg.style.cursor = drawn.cursor;
    tools.hidden = !drawn.tools;
    svg.classList.toggle("ht-done", !drawn.tools);
    button("undo").disabled = !drawn.can.undo;
    button("redo").disabled = !drawn.can.redo;
    button("clear").disabled = !drawn.can.clear;
    button("toggleSymmetry").setAttribute("aria-pressed", String(drawn.symmetry));
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
      const close = pillButton("close", "Close", "Close (Enter)");
      close.disabled = !state.canClose;
      return pill.replaceChildren(count, close, pillButton("end", "End", "End (Esc)"));
    }
    // Never "Done": that belongs to the loaded design.
    const deselect = pillButton("clearSelection", "✕", "Clear selection (Esc)");
    deselect.setAttribute("aria-label", "Clear selection");
    if (state.kind === "shape") return pill.replaceChildren(pillButton("delete", "Delete shape", "Delete shape (Delete)"), deselect);
    const carry = state.canCarryOn ? [pillButton("carryOn", "Carry on", "Carry on (Enter)")] : [];
    // Named for what it makes the point.
    const kind = state.smooth ? "Corner" : "Smooth";
    const toggle = pillButton("toggleKind", kind, `${kind} (S)`);
    pill.replaceChildren(pillButton("delete", "Delete point", "Delete point (Delete)"), toggle, ...carry, deselect);
  };

  /** The editor commands the overlay's buttons press, by their `data-act`. */
  const ACTS = [
    "undo",
    "redo",
    "clear",
    "close",
    "end",
    "delete",
    "carryOn",
    "clearSelection",
    "toggleKind",
    "toggleSymmetry",
  ] as const;
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
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    return { id: e.pointerId, x, y, t: e.timeStamp, pointerType, button: e.button, alt: e.altKey };
  };
  const forward = (gestures: Gesture[]) => {
    if (!editor || gestures.length === 0) return;
    for (const g of gestures) editor.gesture(g);
    render();
  };
  svg.addEventListener("pointerdown", (e) => {
    // A click focuses the canvas, for its keys; a middle press pans rather than autoscrolls.
    svg.focus({ preventScroll: true });
    if (e.button === 1) e.preventDefault();
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
  svg.addEventListener("pointerleave", () => forward(recognizer.leave()));
  // Keys only while the canvas has focus, so Ctrl+Z in a text field still undoes the typing there.
  const isSpace = (e: KeyboardEvent) => e.code === "Space" || e.key === " ";
  svg.addEventListener("keydown", (e) => {
    if (isSpace(e)) {
      e.preventDefault();
      return forward(recognizer.space(true));
    }
    if (!editor || e.altKey) return;
    if (!editor.key({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) return;
    e.preventDefault();
    render();
  });
  svg.addEventListener("keyup", (e) => {
    if (isSpace(e)) forward(recognizer.space(false));
  });
  svg.addEventListener("blur", () => forward(recognizer.space(false)));
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

  const start = (options: Omit<HandTraceOptions, "toDesign">) => {
    svg.setAttribute("aria-label", `${options.photo ? "The cleaned-up photo" : "Blank page"}. ${GESTURES_LABEL}`);
    editor = createHandTrace({ toDesign: designFromPathData, ...options });
    recognizer = createGestureRecognizer();
    reported = editor.design();
    kept = editor.record();
    const r = svg.getBoundingClientRect();
    editor.resize(r.width, r.height);
    render();
  };

  return {
    startBlankPage(restored) {
      photo.removeAttribute("href");
      start({ page: restored?.page, record: restored?.handTrace });
    },
    startPhoto(page, restored) {
      start({ page, record: restored, photo: true });
    },
    setPhoto(href) {
      if (href) photo.setAttribute("href", href);
      else photo.removeAttribute("href");
    },
    setTone(filter) {
      photo.style.filter = filter;
    },
    clear() {
      editor = null;
      reported = null;
      photo.removeAttribute("href");
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
      draw(svg, editor.drawn(), drawingId, photo);
    },
  };
}

/** A pill button that presses editor command `act`, its tooltip `title` naming its key. */
function pillButton(act: string, text: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.act = act;
  b.textContent = text;
  b.title = title;
  return b;
}

/**
 * Draw the page (or `photo` over it), the shapes and their points into a group with `id`, and the loupe over them.
 * The photo is inside the group, so the loupe shows it too.
 */
function draw(svg: SVGSVGElement, drawn: Drawn, id: string, photo: SVGElement): void {
  const { page, axis } = drawn;
  const parts: SVGElement[] = [el("rect", { class: "ht-page", ...page }, DECIMALS)];
  if (!drawn.grid) {
    for (const name of ["x", "y", "width", "height"] as const) photo.setAttribute(name, page[name].toFixed(DECIMALS));
    parts.push(photo);
  }
  for (let i = 1; drawn.grid && i < GRID_DIVISIONS; i++) {
    const [x, y] = [page.x + (page.width * i) / GRID_DIVISIONS, page.y + (page.height * i) / GRID_DIVISIONS];
    parts.push(el("line", { class: "ht-grid", x1: x, y1: page.y, x2: x, y2: page.y + page.height }, DECIMALS));
    parts.push(el("line", { class: "ht-grid", x1: page.x, y1: y, x2: page.x + page.width, y2: y }, DECIMALS));
  }
  if (axis) {
    const cls = axis.snapped ? "ht-axis snapped" : "ht-axis";
    parts.push(el("line", { class: cls, x1: axis.from.x, y1: axis.from.y, x2: axis.to.x, y2: axis.to.y }, DECIMALS));
  }
  if (drawn.fill) parts.push(el("path", { class: "ht-fill", d: drawn.fill }));
  const { warnings } = drawn;
  for (const d of warnings.floating) parts.push(el("path", { class: "ht-warn-tint", d }));
  const { hover, rubberBand } = drawn;
  for (const shape of drawn.shapes) {
    const hovered = hover?.kind === "shape" && hover.id === shape.id;
    const cls = ["ht-line", !shape.closed && "open", shape.drawing && "drawing", shape.selected && "selected"]
      .concat(hovered && "hover")
      .filter(Boolean)
      .join(" ");
    parts.push(el("path", { class: cls, d: shape.d }));
  }
  if (rubberBand) {
    const { from, to } = rubberBand;
    parts.push(el("line", { class: "ht-rubber-band", x1: from.x, y1: from.y, x2: to.x, y2: to.y }, DECIMALS));
  }
  if (hover && hover.kind !== "shape") {
    parts.push(el("circle", { class: "ht-hover", cx: hover.at.x, cy: hover.at.y, r: HOVER_RING_PX }, DECIMALS));
  }
  // Over the lines they mark, under the points so those stay plain to see.
  for (const { x, y } of warnings.crossings) {
    parts.push(el("circle", { class: "ht-warn-ring", cx: x, cy: y, r: CROSSING_RING_PX }, DECIMALS));
  }
  for (const { at, r } of warnings.tiny) {
    const radius = Math.max(r + TINY_RING_GAP_PX, TINY_RING_MIN_PX);
    parts.push(el("circle", { class: "ht-warn-ring", cx: at.x, cy: at.y, r: radius }, DECIMALS));
  }
  // Neighbours' handles and stubs under the points, the selected point's own over everything.
  const handle = (h: Drawn["handles"][number]) => {
    const cls = h.kind === "own" ? "" : ` ${h.kind}`;
    const { from, to } = h;
    const r = h.kind === "neighbour" ? NEIGHBOUR_HANDLE_PX : HANDLE_PX;
    const knob = el("circle", { class: `ht-handle${cls}${h.selected ? " selected" : ""}`, cx: to.x, cy: to.y, r }, DECIMALS);
    return [el("line", { class: `ht-handle-line${cls}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y }, DECIMALS), knob];
  };
  for (const h of drawn.handles) if (h.kind !== "own") parts.push(...handle(h));
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
  for (const h of drawn.handles) if (h.kind === "own") parts.push(...handle(h));
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
