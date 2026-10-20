import { fitProfile, type Point2, type ProfileFit, type PumpkinMeasurements, type Units } from "../core";
import {
  blueprintView,
  clampZoom,
  fitScale,
  HANDLE_WIDTH,
  MIN_ZOOM,
  type BlueprintDrawing,
  type BlueprintLabel,
} from "../blueprintView";
import { ballMeasurements } from "../input/calibrationGrid";
import type { MeasureState } from "../measureState";
import { dragBall, dragHeight, dragRing, type RingId, type RingMeasurements, type RingWithId } from "../ringEdits";

const SVG = "http://www.w3.org/2000/svg";
/** Each zoom step (a button press or a +/− key), as a factor. */
const ZOOM_STEP = 1.25;
/** How much one wheel notch (100 px of deltaY) zooms: about 14 %. */
const WHEEL_RATE = 0.0015;
/** A handle's hit radius, px. */
const HIT_RADIUS = 22;
/** How long the scale takes to ease to the new fit after a drag, ms. */
const THAW_MS = 220;

export interface BlueprintPane {
  /**
   * The shared measurements changed: refit the profile and redraw. In test-grid mode the first ring is the ball,
   * drawn as a circle.
   */
  show(state: MeasureState, ball: boolean): void;
  /** Label the ruler and the rings in these display units. */
  setUnits(units: Units): void;
}

/**
 * A drag changed the measurements: `edited` is the ring dragged (null: the height). Called once per animation
 * frame while the drag goes on (`live`), then once more when it ends.
 */
export type BlueprintEdit = (measurements: RingMeasurements, edited: RingId | null, live: boolean) => void;

/** A handle being dragged. */
interface Drag {
  kind: "ring" | "ball" | "height";
  /** The dragged ring's index in the drawn measurements (none for the height). */
  index: number | null;
  /** The ring dragged, as it was when the drag began (none for the height). */
  ring: RingWithId | null;
  /** The measurements and fit when the drag began: the rules' limits and a height drag's profile come from them. */
  start: RingMeasurements;
  fit: ProfileFit;
  /** Where the pointer went down, px, and the px per mm then (held for the whole drag). */
  x0: number;
  y0: number;
  scale: number;
  /** The measurements the pointer last asked for, waiting for the next animation frame. */
  next: RingMeasurements | null;
}

/**
 * The Blueprint view: the pumpkin drawn flat from the front at true scale against a ruler, on blueprint paper.
 * Dragging a ring's handle sets its circumference (sideways) and height above the table (up and down), and the
 * height's handle sets the height, through the ring-edit rules; Alt drags free of the grid. The profile refits
 * once per animation frame while dragging and the scale holds still, easing to the new fit on release.
 * Zoom (0.25× to 1×, anchored at the bottom middle) comes from the stacked buttons, the scroll wheel and the +/−
 * keys while the view has focus; it isn't saved. The geometry is `blueprintView`; this only draws it as SVG at
 * the element's size in px and handles the pointer.
 */
export function mountBlueprintView(root: HTMLElement, onEdit: BlueprintEdit): BlueprintPane {
  root.innerHTML = `
    <svg class="bp-svg" tabindex="0" role="img"
      aria-label="Blueprint: the pumpkin's profile drawn to scale against a ruler, with each ring as a line. Press + or − to zoom."></svg>
    <div class="bp-banner" hidden></div>
    <div class="bp-zoom" role="group" aria-label="Zoom">
      <button type="button" data-zoom="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
      <button type="button" data-zoom="fit" title="Fit the pumpkin" aria-label="Fit the pumpkin">⤢</button>
    </div>
  `;
  const svg = root.querySelector<SVGSVGElement>(".bp-svg")!;
  const banner = root.querySelector<HTMLElement>(".bp-banner")!;
  const buttons = Object.fromEntries(
    [...root.querySelectorAll<HTMLButtonElement>("[data-zoom]")].map((b) => [b.dataset.zoom, b]),
  ) as Record<"in" | "out" | "fit", HTMLButtonElement>;

  let state: MeasureState = { measurements: { height: Number.NaN, rings: [] }, lastEdited: null };
  let ball = false;
  let units: Units = "in";
  let zoom = 1;
  /** The fit for `fitKey`'s measurements: refitted only when they change. */
  let fit: ProfileFit = fitProfile(drawn());
  let fitKey = "";
  /** The px per mm at 1× to draw at instead of the fit's: frozen while dragging, then easing to the fit. */
  let heldScale: number | null = null;
  /** The px per mm at 1× and the drawing, as last drawn. */
  let shownScale = Number.NaN;
  let shown: BlueprintDrawing | null = null;
  let drag: Drag | null = null;
  let frame = 0;
  let thaw = 0;

  /** What's drawn: the measurements, or in test-grid mode the ball measured by the first ring. */
  function drawn(): PumpkinMeasurements {
    const { measurements } = state;
    return ball ? ballMeasurements(measurements.rings[0]?.circumference ?? Number.NaN) : measurements;
  }

  const refit = () => {
    const measurements = drawn();
    const key = JSON.stringify(measurements);
    if (key === fitKey) return;
    fit = fitProfile(measurements);
    fitKey = key;
  };

  const size = () => ({ width: svg.clientWidth, height: svg.clientHeight });

  const render = () => {
    buttons.in.disabled = buttons.fit.disabled = zoom >= 1;
    buttons.out.disabled = zoom <= MIN_ZOOM;
    const view = size();
    // Hidden (another view showing): drawn when it next shows and gets a size.
    if (view.width === 0 || view.height === 0) return;
    const measurements = drawn();
    shownScale = heldScale ?? fitScale({ measurements, fit, size: view, units });
    const blamed = state.measurements.rings.findIndex((r) => r.id === state.lastEdited);
    shown = blueprintView({
      measurements,
      fit,
      ball,
      zoom,
      size: view,
      units,
      fitScale: shownScale,
      blame: ball || blamed < 0 ? null : blamed,
      readout: drag ? (drag.kind === "height" ? "height" : drag.index) : null,
    });
    svg.replaceChildren(...draw(shown));
    banner.textContent = shown.banner ?? "";
    banner.hidden = shown.banner === null;
  };

  const setZoom = (next: number) => {
    zoom = clampZoom(next);
    render();
  };

  /** Ease the held scale to the current fit, then let it go. */
  const thawScale = () => {
    if (heldScale === null) return;
    const from = heldScale;
    const t0 = performance.now();
    const step = (now: number) => {
      // A frame's timestamp can come from just before the release.
      const k = Math.min(1, Math.max(0, (now - t0) / THAW_MS));
      const view = size();
      const to = view.width > 0 && view.height > 0 ? fitScale({ measurements: drawn(), fit, size: view, units }) : from;
      heldScale = k < 1 ? from + (to - from) * (1 - (1 - k) ** 3) : null;
      render();
      thaw = heldScale === null ? 0 : requestAnimationFrame(step);
    };
    thaw = requestAnimationFrame(step);
  };

  /** Take the measurements a drag asked for: refit (or rescale, for the height), redraw and pass them on. */
  const apply = (d: Drag, measurements: RingMeasurements, live: boolean) => {
    const edited = d.ring?.id ?? null;
    state = { measurements, lastEdited: edited ?? state.lastEdited };
    if (d.kind === "height" && live && d.fit.ok) {
      // The rings keep their fractions and circumferences, so the profile only stretches up or down.
      const k = measurements.height / d.start.height;
      fit = { ...d.fit, profile: d.fit.profile.map((p) => ({ radius: p.radius, height: p.height * k })) };
      fitKey = "";
    } else refit();
    render();
    onEdit(measurements, edited, live);
  };

  svg.addEventListener("pointerdown", (e) => {
    const handle = (e.target as Element).closest<SVGElement>("[data-handle]");
    if (!handle || !shown || e.button !== 0 || drag) return;
    e.preventDefault();
    svg.focus();
    svg.setPointerCapture(e.pointerId);
    cancelAnimationFrame(thaw);
    const kind = handle.dataset.handle as Drag["kind"];
    const index = kind === "height" ? null : Number(handle.dataset.ring);
    const start = state.measurements;
    // A ball is measured by the first ring.
    const ring = index === null ? null : start.rings[kind === "ball" ? 0 : index] ?? null;
    drag = { kind, index, ring, start, fit, x0: e.clientX, y0: e.clientY, scale: shown.scale, next: null };
    heldScale = shownScale;
    svg.classList.add("bp-dragging");
    render();
  });

  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const d = drag;
    // The pointer's travel in mm: right is wider, up is higher.
    const dx = (e.clientX - d.x0) / d.scale;
    const up = (d.y0 - e.clientY) / d.scale;
    const options = { units, snap: !e.altKey };
    const { start, ring } = d;
    const edit =
      d.kind === "height"
        ? dragHeight(start, start.height + up, options)
        : d.kind === "ball"
          ? dragBall(start, ring!.id, ring!.circumference + 2 * Math.PI * dx, options)
          : dragRing(start, ring!.id, { above: ring!.position * start.height + up, circumference: ring!.circumference + 2 * Math.PI * dx }, options);
    d.next = edit.measurements;
    // One refit per animation frame, however often the pointer moves.
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (drag?.next) apply(drag, drag.next, true);
      });
    }
  });

  const endDrag = () => {
    if (!drag) return;
    cancelAnimationFrame(frame);
    frame = 0;
    const d = drag;
    drag = null;
    svg.classList.remove("bp-dragging");
    if (d.next) apply(d, d.next, false);
    else render();
    thawScale();
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  root.querySelector(".bp-zoom")!.addEventListener("click", (e) => {
    const kind = (e.target as Element).closest<HTMLElement>("[data-zoom]")?.dataset.zoom;
    if (kind === "in") setZoom(zoom * ZOOM_STEP);
    else if (kind === "out") setZoom(zoom / ZOOM_STEP);
    else if (kind === "fit") setZoom(1);
  });
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * WHEEL_RATE));
    },
    { passive: false },
  );
  svg.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") setZoom(zoom * ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") setZoom(zoom / ZOOM_STEP);
    else return;
    e.preventDefault();
  });
  new ResizeObserver(render).observe(svg);

  return {
    show(next, isBall) {
      // A drag owns the drawing until it ends.
      if (drag) return;
      state = next;
      ball = isBall;
      refit();
      render();
    },
    setUnits(next) {
      units = next;
      render();
    },
  };
}

/** The drawing as SVG elements, back to front. */
function draw(d: BlueprintDrawing): SVGElement[] {
  const out: SVGElement[] = [];

  const ruler = el("g", { class: "bp-ruler" });
  ruler.append(el("line", { class: "bp-ruler-line", x1: d.ruler.x, y1: d.ruler.y1, x2: d.ruler.x, y2: d.ruler.y2 }));
  for (const t of d.ruler.ticks) {
    ruler.append(el("line", { class: t.major ? "bp-tick bp-tick-major" : "bp-tick", x1: d.ruler.x - t.length, y1: t.y, x2: d.ruler.x, y2: t.y }));
  }
  for (const l of d.ruler.labels) ruler.append(text(l.x, l.y, l.text, "bp-ruler-label", "end"));
  if (d.ruler.units) ruler.append(text(d.ruler.units.x, d.ruler.units.y, d.ruler.units.text, "bp-ruler-label", "end"));
  out.push(ruler);

  if (d.circle) out.push(el("circle", { class: "bp-profile", cx: d.circle.cx, cy: d.circle.cy, r: d.circle.r }));
  if (d.profile) {
    const { right, left, rough } = d.profile;
    const points = [...right, ...[...left].reverse()];
    out.push(el("path", { class: rough ? "bp-profile bp-profile-rough" : "bp-profile", d: `M${points.map(xy).join("L")}Z` }));
  }

  if (d.height) {
    const h = d.height;
    const g = el("g", { class: "bp-height" });
    g.append(
      el("line", { class: "bp-height-line", x1: h.x1, y1: h.y, x2: h.x2, y2: h.y }),
      label(h.label, "bp-height-label"),
      pill(h.handle),
      el("path", { class: "bp-icon", d: upDownIcon(h.handle.x, h.handle.y) }),
      hit(h.handle, { "data-handle": "height" }),
    );
    out.push(g);
  }

  // A ball has one ring, sized sideways only.
  const ringHandle = d.circle ? "ball" : "ring";
  for (const r of d.rings) {
    const g = el("g", { class: "bp-ring", "data-ring": r.index });
    g.append(el("line", { class: "bp-ring-line", x1: r.x1, y1: r.y, x2: r.x2, y2: r.y }));
    if (r.label.leader) {
      const { x1, x2, y } = r.label.leader;
      g.append(el("line", { class: "bp-leader", x1, y1: y, x2, y2: y }));
    }
    g.append(
      label(r.label, "bp-ring-label"),
      pill(r.handle),
      el("path", { class: "bp-icon", d: moveIcon(r.handle.x, r.handle.y) }),
      hit(r.handle, { "data-handle": ringHandle, "data-ring": r.index }),
    );
    out.push(g);
  }
  return out;
}

/** A handle's invisible hit area, wider than its pill, carrying what it drags. */
function hit(c: Point2, data: Record<string, string | number>): SVGElement {
  return el("circle", { class: "bp-hit", cx: c.x, cy: c.y, r: HIT_RADIUS, ...data });
}

/** A label's text, with its height above the table muted after it ("32 ¾ in   at 6 ½ in"). */
function label(l: BlueprintLabel, cls: string): SVGElement {
  const t = text(l.x, l.y, l.text, cls, "start");
  if (l.at) {
    // The spaces are kept (white-space: pre in the CSS).
    const at = el("tspan", { class: "bp-ring-at" });
    at.textContent = `   ${l.at}`;
    t.append(at);
  }
  return t;
}

/** A handle's pill, centred on `c`. */
function pill(c: Point2): SVGElement {
  const h = 22;
  return el("rect", { class: "bp-handle", x: c.x - HANDLE_WIDTH / 2, y: c.y - h / 2, width: HANDLE_WIDTH, height: h, rx: h / 2 });
}

function text(x: number, y: number, s: string, cls: string, anchor: "start" | "end"): SVGElement {
  const t = el("text", { class: cls, x, y, "text-anchor": anchor, "dominant-baseline": "middle" });
  t.textContent = s;
  return t;
}

/** A four-way move glyph (a cross with arrowheads) centred on (x, y). */
function moveIcon(x: number, y: number, k = 7): string {
  return (
    `M${x - k},${y}H${x + k}M${x},${y - k}V${y + k}` +
    `M${x - k + 3},${y - 3}L${x - k},${y}L${x - k + 3},${y + 3}M${x + k - 3},${y - 3}L${x + k},${y}L${x + k - 3},${y + 3}` +
    `M${x - 3},${y - k + 3}L${x},${y - k}L${x + 3},${y - k + 3}M${x - 3},${y + k - 3}L${x},${y + k}L${x + 3},${y + k - 3}`
  );
}

/** An up/down arrow glyph centred on (x, y). */
function upDownIcon(x: number, y: number, k = 7): string {
  return `M${x},${y - k}V${y + k}M${x - 3},${y - k + 3}L${x},${y - k}L${x + 3},${y - k + 3}M${x - 3},${y + k - 3}L${x},${y + k}L${x + 3},${y + k - 3}`;
}

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(typeof v === "number" ? round(v) : v));
  return node;
}

function xy(p: Point2): string {
  return `${round(p.x)},${round(p.y)}`;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
