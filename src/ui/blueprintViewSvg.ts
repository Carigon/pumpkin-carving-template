import { fitProfile, type Point2, type ProfileFit, type PumpkinMeasurements, type Units } from "../core";
import { blueprintView, clampZoom, HANDLE_WIDTH, MIN_ZOOM, type BlueprintDrawing, type BlueprintLabel } from "../blueprintView";

const SVG = "http://www.w3.org/2000/svg";
/** Each zoom step (a button press or a +/− key), as a factor. */
const ZOOM_STEP = 1.25;
/** How much one wheel notch (100 px of deltaY) zooms: about 14 %. */
const WHEEL_RATE = 0.0015;

export interface BlueprintPane {
  /** The measurements changed (mm; in test-grid mode the ball's): refit the profile and redraw. */
  show(measurements: PumpkinMeasurements, ball: boolean): void;
  /** Label the ruler and the rings in these display units. */
  setUnits(units: Units): void;
}

/**
 * The Blueprint view: the pumpkin drawn flat from the front at true scale against a ruler, on blueprint paper,
 * following the Measure form. Zoom (0.25× to 1×, anchored at the bottom middle) comes from the stacked buttons,
 * the scroll wheel and the +/− keys while the view has focus; it isn't saved. The geometry is `blueprintView`;
 * this only draws it as SVG at the element's size in px.
 */
export function mountBlueprintView(root: HTMLElement): BlueprintPane {
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

  let measurements: PumpkinMeasurements = { height: Number.NaN, rings: [] };
  let ball = false;
  let units: Units = "in";
  let zoom = 1;
  /** The fit for `fitKey`'s measurements: refitted only when they change. */
  let fit: ProfileFit = fitProfile(measurements);
  let fitKey = "";

  const render = () => {
    const size = { width: svg.clientWidth, height: svg.clientHeight };
    buttons.in.disabled = buttons.fit.disabled = zoom >= 1;
    buttons.out.disabled = zoom <= MIN_ZOOM;
    // Hidden (another view showing): drawn when it next shows and gets a size.
    if (size.width === 0 || size.height === 0) return;
    const drawing = blueprintView({ measurements, fit, ball, zoom, size, units });
    svg.replaceChildren(...draw(drawing));
    banner.textContent = drawing.banner ?? "";
    banner.hidden = drawing.banner === null;
  };

  const setZoom = (next: number) => {
    zoom = clampZoom(next);
    render();
  };

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
      measurements = next;
      ball = isBall;
      const key = JSON.stringify(next);
      if (key !== fitKey) {
        fit = fitProfile(next);
        fitKey = key;
      }
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
    );
    out.push(g);
  }

  for (const r of d.rings) {
    const g = el("g", { class: "bp-ring", "data-ring": r.index });
    g.append(el("line", { class: "bp-ring-line", x1: r.x1, y1: r.y, x2: r.x2, y2: r.y }));
    if (r.label.leader) {
      const { x1, x2, y } = r.label.leader;
      g.append(el("line", { class: "bp-leader", x1, y1: y, x2, y2: y }));
    }
    g.append(label(r.label, "bp-ring-label"), pill(r.handle), el("path", { class: "bp-icon", d: moveIcon(r.handle.x, r.handle.y) }));
    out.push(g);
  }
  return out;
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
