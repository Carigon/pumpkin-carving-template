import {
  createGestureRecognizer,
  createHandTrace,
  type Drawn,
  type Gesture,
  type HandTrace,
  type PointerInput,
} from "../handTrace";
import { designFromPathData } from "../input/pathDesign";
import { el } from "./svg";

export interface HandTraceCanvas {
  /** Start a new hand-trace on a blank page, replacing any other. */
  startBlankPage(): void;
  /** Forget the hand-trace (another design was loaded). */
  clear(): void;
  /** The hand-trace being shown, or null when there's none. */
  editor(): HandTrace | null;
  /** Done (true) or Edit (false): hide the tools and stop taking input, or bring them back. */
  setDone(done: boolean): void;
}

/** Grid lines across the blank page, each way: faint, so pan and zoom show. */
const GRID_DIVISIONS = 10;
/** Drawn sizes in screen px. */
const POINT_HALF_PX = 5;
const END_RING_PX = 9;
const CLOSE_RING_PX = 12;
/** Decimals kept in screen coordinates. */
const DECIMALS = 1;

/**
 * The hand-trace canvas in the Page view: draws what the editor says is drawn, in SVG, and forwards pointer and
 * wheel events to it through the gesture recognizer. Calls `onChange` after each finished change to the shapes
 * (the editor's `Design` is a new object then), never mid-drag. Every decision is the editor's.
 */
export function mountHandTraceCanvas(view: HTMLElement, onChange: () => void): HandTraceCanvas {
  view.classList.add("hand-trace");
  view.innerHTML = `
    <svg class="ht-svg" role="img" aria-label="Blank page. Tap or click to place points; drag to pan, scroll to zoom."></svg>
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
  /** The Design last reported through `onChange`, to tell when a change finished. */
  let reported: unknown = null;

  /** Draw the editor's state, and report the Design if a change to the shapes finished. */
  const render = () => {
    if (!editor) return svg.replaceChildren();
    const drawn = editor.drawn();
    draw(svg, drawn);
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
  };

  const renderPill = ({ pill: state }: Drawn) => {
    if (state.kind === "hint") return void (pill.textContent = state.text);
    const count = document.createElement("span");
    count.textContent = `${state.points} point${state.points === 1 ? "" : "s"}`;
    const close = document.createElement("button");
    close.type = "button";
    close.dataset.act = "close";
    close.textContent = "Close";
    close.disabled = !state.canClose;
    const end = document.createElement("button");
    end.type = "button";
    end.dataset.act = "end";
    end.textContent = "End";
    pill.replaceChildren(count, close, end);
  };

  tools.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
    if (!editor || !act) return;
    if (act === "undo" || act === "redo" || act === "clear" || act === "close" || act === "end") editor[act]();
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
    svg.setPointerCapture(e.pointerId);
    forward(recognizer.down(input(e)));
  });
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
    startBlankPage() {
      editor = createHandTrace({ toDesign: designFromPathData });
      recognizer = createGestureRecognizer();
      reported = editor.design();
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
  };
}

/** Draw the page, the shapes and their points. */
function draw(svg: SVGSVGElement, drawn: Drawn): void {
  const { page, axis } = drawn;
  const parts: SVGElement[] = [el("rect", { class: "ht-page", ...page }, DECIMALS)];
  for (let i = 1; i < GRID_DIVISIONS; i++) {
    const [x, y] = [page.x + (page.width * i) / GRID_DIVISIONS, page.y + (page.height * i) / GRID_DIVISIONS];
    parts.push(el("line", { class: "ht-grid", x1: x, y1: page.y, x2: x, y2: page.y + page.height }, DECIMALS));
    parts.push(el("line", { class: "ht-grid", x1: page.x, y1: y, x2: page.x + page.width, y2: y }, DECIMALS));
  }
  parts.push(el("line", { class: "ht-axis", x1: axis.from.x, y1: axis.from.y, x2: axis.to.x, y2: axis.to.y }, DECIMALS));
  if (drawn.fill) parts.push(el("path", { class: "ht-fill", d: drawn.fill }));
  for (const shape of drawn.shapes) {
    const cls = `ht-line${shape.closed ? "" : " open"}${shape.drawing ? " drawing" : ""}`;
    parts.push(el("path", { class: cls, d: shape.d }));
  }
  for (const p of drawn.points) {
    const { x, y } = p.at;
    if (p.closable) parts.push(el("circle", { class: "ht-close-ring", cx: x, cy: y, r: CLOSE_RING_PX }, DECIMALS));
    if (p.end) parts.push(el("circle", { class: "ht-end", cx: x, cy: y, r: END_RING_PX }, DECIMALS));
    const half = POINT_HALF_PX;
    parts.push(
      p.kind === "smooth"
        ? el("circle", { class: "ht-point", cx: x, cy: y, r: half }, DECIMALS)
        : el("rect", { class: "ht-point", x: x - half, y: y - half, width: 2 * half, height: 2 * half }, DECIMALS),
    );
  }
  svg.replaceChildren(...parts);
}
