/**
 * PROTOTYPE — throwaway, for "Blueprint view look and drag feel" (issue #41, map #37). Not production code: no
 * tests, no a11y, no error handling. Lives on the `prototype/blueprint-view` branch only.
 *
 * Three looks for the Blueprint view on the Measure step, switchable via `?variant=A|B|C` and the floating bar
 * at the bottom. They disagree on handle shape and hit area, line overhang, label placement, gap highlight,
 * selection and ×, zoom controls, height handle, drag axis and how a fit failure reads. The "freeze" toggle in
 * the bar flips whether the scale freezes while any handle is dragged (refitting on release), so any variant can
 * try both.
 * Edits refit the outline live (outline-only fit) and write to the real form on release, which rebuilds 3D.
 */
import type { PumpkinMeasurements, Units } from "../core";
import { angleAt, fitProfile, profileAt, type Profile } from "../core/surface/profile";

type VariantKey = "A" | "B" | "C";

interface Look {
  name: string;
  /** Overhang of the ring line past the outline, as px = a·radiusPx + b. */
  overhang: { a: number; b: number };
  handle: "dot" | "tab" | "pill";
  /** Visible handle size and hit radius, px. */
  handleSize: number;
  hit: number;
  label: "line" | "ruler" | "chip";
  gap: "band" | "hatch" | "wide";
  zoomUi: "stack" | "pill" | "slider";
  heightHandle: "bar" | "ruler" | "cap";
  /** Default for "freeze scale while dragging the height". */
  freeze: boolean;
  /** Drag locks to the dominant axis after a few px. */
  axisLock: boolean;
  warn: "banner" | "inline" | "toast";
}

const LOOKS: Record<VariantKey, Look> = {
  A: {
    name: "Drafting table",
    overhang: { a: 0, b: 14 },
    handle: "dot",
    handleSize: 12,
    hit: 18,
    label: "line",
    gap: "band",
    zoomUi: "stack",
    heightHandle: "bar",
    freeze: true,
    axisLock: false,
    warn: "banner",
  },
  B: {
    name: "Paper sketch",
    overhang: { a: 0.08, b: 6 },
    handle: "tab",
    handleSize: 10,
    hit: 16,
    label: "ruler",
    gap: "hatch",
    zoomUi: "pill",
    heightHandle: "ruler",
    freeze: false,
    axisLock: false,
    warn: "inline",
  },
  C: {
    name: "Tool palette",
    overhang: { a: 0, b: 22 },
    handle: "pill",
    handleSize: 22,
    hit: 22,
    label: "chip",
    gap: "wide",
    zoomUi: "slider",
    heightHandle: "cap",
    freeze: true,
    axisLock: true,
    warn: "toast",
  },
};

const CM_PER: Record<Units, number> = { in: 2.54, cm: 1 };
const MIN_ZOOM = 0.25;
const SVGNS = "http://www.w3.org/2000/svg";

interface ProtoRing {
  id: number;
  position: number;
  circumference: number;
}

export interface BlueprintPrototype {
  /** The form's current measurements (and mode); ignored mid-drag. */
  sync(m: PumpkinMeasurements, ball: boolean): void;
}

/** `onCommit` gets the full height and rings (in the form's units) when a drag ends or a ring is added/removed. */
export function mountBlueprintPrototype(
  root: HTMLElement,
  onCommit: (m: { height: number; rings: { position: number; circumference: number }[] }) => void,
): BlueprintPrototype {
  injectStyle();
  const params = new URLSearchParams(location.search);
  let variant: VariantKey = (["A", "B", "C"] as const).find((v) => v === params.get("variant")) ?? "A";
  let freeze = LOOKS[variant].freeze;

  root.innerHTML = `
    <svg class="bp-svg" tabindex="0" aria-label="Blueprint view (prototype)"></svg>
    <div class="bp-zoom"></div>
    <div class="bp-warn" hidden></div>
    <div class="bp-confirm" hidden>
      <div>Delete this ring?</div>
      <label><input type="checkbox" class="bp-dont-ask" /> Don't ask again</label>
      <div class="bp-confirm-buttons"><button class="bp-yes">Delete</button><button class="bp-no">Cancel</button></div>
    </div>
  `;
  const svg = root.querySelector<SVGSVGElement>(".bp-svg")!;
  const zoomBox = root.querySelector<HTMLElement>(".bp-zoom")!;
  const warnBox = root.querySelector<HTMLElement>(".bp-warn")!;
  const confirmBox = root.querySelector<HTMLElement>(".bp-confirm")!;

  let units: Units = "in";
  let height = Number.NaN;
  let rings: ProtoRing[] = [];
  let ball = false;
  let nextId = 1;
  let zoom = 1;
  let selected: number | null = null;
  let hoverGap: number | null = null;
  let askBeforeDelete = true;
  let fitMs = 0;
  let fit: { ok: true; profile: Profile } | { ok: false; ring: number } | null = null;
  let commitTimer = 0;
  let lastCommit = "";

  type Drag =
    | { kind: "ring"; id: number; x0: number; y0: number; r0: number; p0: number; lo: number; hi: number; axis: "x" | "y" | null }
    | { kind: "height"; y0: number; h0: number; s0: number; hMin: number }
    | { kind: "ball"; x0: number; r0: number };
  let drag: Drag | null = null;
  /** Fit scale (px per unit at zoom 1) frozen at the start of a height drag. */
  let frozenFit: number | null = null;
  /** The fit scale on screen, tweened toward the target after a frozen drag ends. */
  let shownFit: number | null = null;
  let tween = 0;

  // --- units and limits -------------------------------------------------------------------------------------
  const cm = (x: number) => x / CM_PER[units];
  const snapStep = () => (units === "in" ? 1 / 8 : 0.1);
  const minGap = () => (units === "in" ? 0.25 : 0.5);
  const snap = (x: number, free: boolean) => (free ? x : Math.round(x / snapStep()) * snapStep());
  const clampCirc = (c: number) => Math.min(2 * Math.PI * cm(50), Math.max(2 * Math.PI * cm(1), c));
  const fmt = (x: number, digits = 1) => `${x.toFixed(digits)} ${units}`;
  const fmtSnapped = (x: number) => {
    if (units === "cm") return `${x.toFixed(1)} cm`;
    const whole = Math.floor(x + 1e-9), eighths = Math.round((x - whole) * 8);
    const frac = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"][eighths % 8] ?? "";
    return `${eighths === 8 ? whole + 1 : whole}${frac ? " " + frac : ""} in`;
  };
  /** The circumference label: snapped fractions at rest, 0.1 while dragging. */
  const circLabel = (c: number, dragging: boolean) => (dragging ? fmt(c) : fmtSnapped(c));

  const sorted = () => [...rings].sort((a, b) => a.position - b.position);
  const valid = () => Number.isFinite(height) && height > 0;

  // --- fitting ------------------------------------------------------------------------------------------------
  const refit = () => {
    if (!valid() || ball || rings.length === 0) {
      fit = null;
      return;
    }
    const t = performance.now();
    fit = fitProfile(height, rings.map((r) => ({ position: r.position, radius: r.circumference / (2 * Math.PI) })));
    fitMs = performance.now() - t;
  };
  const radiusAt = (position: number): number => {
    if (fit?.ok) return profileAt(fit.profile, angleAt(position)).radius;
    const s = sorted();
    const below = [...s].reverse().find((r) => r.position <= position), above = s.find((r) => r.position >= position);
    const r = (x: ProtoRing) => x.circumference / (2 * Math.PI);
    if (below && above && above !== below) return r(below) + ((position - below.position) / (above.position - below.position)) * (r(above) - r(below));
    return (below ?? above) ? r((below ?? above)!) : 0;
  };

  // --- layout -------------------------------------------------------------------------------------------------
  const RULER_X = 44;
  const LABEL_W = 84;
  const TOP = 56, BOTTOM = 40;
  const widest = () => {
    let r = Math.max(0, ...rings.map((x) => x.circumference / (2 * Math.PI)));
    if (fit?.ok) for (let i = 0; i <= 64; i++) r = Math.max(r, profileAt(fit.profile, (Math.PI * i) / 64).radius);
    return r;
  };
  /** Px per unit at zoom 1: the current pumpkin plus margin fills the view. */
  const targetFit = (h = height) => {
    const W = svg.clientWidth, H = svg.clientHeight;
    const extent = ball ? (rings[0]?.circumference ?? 0) / Math.PI : h;
    const r = ball ? extent / 2 : widest();
    if (!(extent > 0)) return (H - TOP - BOTTOM) / (units === "in" ? 12 : 30);
    const look = LOOKS[variant];
    const byH = (H - TOP - BOTTOM) / extent;
    // Room each side of the middle for the radius, overhang, handle and (left) the label, clear of the ruler.
    const side = W / 2 - RULER_X - 16 - LABEL_W - look.overhang.b - look.handleSize;
    const byW = side / (r * (1 + look.overhang.a) || 1);
    return Math.max(0.5, Math.min(byH, byW));
  };
  const fitScale = () => frozenFit ?? shownFit ?? targetFit();
  const scale = () => fitScale() * zoom;
  const cx = () => svg.clientWidth / 2;
  const baseY = () => svg.clientHeight - BOTTOM;
  const sx = (x: number) => cx() + x * scale();
  const sy = (y: number) => baseY() - y * scale();
  const overhangPx = (rPx: number) => LOOKS[variant].overhang.a * rPx + LOOKS[variant].overhang.b;

  // --- drawing ------------------------------------------------------------------------------------------------
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.appendChild(e);
    return e;
  };
  const text = (x: number, y: number, s: string, cls: string, anchor = "end", parent: Element = svg) => {
    const t = el("text", { x, y, class: cls, "text-anchor": anchor, "dominant-baseline": "middle" }, parent);
    t.textContent = s;
    return t;
  };

  const render = () => {
    const look = LOOKS[variant];
    root.className = `view view-blueprint bp-${variant}`;
    svg.replaceChildren();
    el("defs", {}).innerHTML = `
      <pattern id="bp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" class="bp-hatch-line" />
      </pattern>`;
    const s = scale();
    drawRuler(s);
    if (!valid() && !ball) {
      renderZoom();
      showWarn(null);
      return;
    }
    if (ball) {
      showWarn(null);
      drawBall(s);
    } else drawPumpkin(s, look);
    renderZoom();
    renderState();
  };

  const drawRuler = (s: number) => {
    const g = el("g", { class: "bp-ruler" });
    el("line", { x1: RULER_X, y1: baseY(), x2: RULER_X, y2: 0, class: "bp-ruler-line" }, g);
    const labelled = valid() || (ball && rings[0]);
    const extent = ball ? (rings[0]?.circumference ?? 0) / Math.PI : height;
    const top = Math.ceil(labelled ? extent : 0);
    const steps = [1, 2, 5, 10, 20, 50];
    const labelStep = steps.find((k) => k * s >= 22) ?? 100;
    const minor = s >= 24 ? (units === "in" ? 0.25 : 0.5) : s >= 10 ? 1 : labelStep;
    const maxY = baseY() / s;
    for (let y = 0; y <= maxY + 1e-9; y += minor) {
      const whole = Math.abs(y - Math.round(y)) < 1e-6;
      const major = whole && Math.round(y) % labelStep === 0;
      const len = major ? 10 : whole ? 6 : 3;
      el("line", { x1: RULER_X - len, y1: sy(y), x2: RULER_X, y2: sy(y), class: major ? "bp-tick bp-tick-major" : "bp-tick" }, g);
      if (labelled && major && Math.round(y) <= top) text(RULER_X - 13, sy(y), String(Math.round(y)), "bp-ruler-label", "end", g);
    }
    if (labelled) text(RULER_X - 13, sy(top) - 16, units, "bp-ruler-units", "end", g);
  };

  const outlinePath = (): string => {
    if (fit?.ok) {
      const pts: [number, number][] = [];
      const N = 128;
      for (let i = 0; i <= N; i++) {
        const p = profileAt(fit.profile, (Math.PI * i) / N);
        pts.push([p.radius, height / 2 + p.y]);
      }
      const right = pts.map(([x, y]) => `${sx(x)},${sy(y)}`);
      const left = [...pts].reverse().map(([x, y]) => `${sx(-x)},${sy(y)}`);
      return `M${right.join("L")}L${left.join("L")}Z`;
    }
    // No fit: a rough guess through the rings, drawn dashed.
    const pts: [number, number][] = [[0, height], ...[...sorted()].reverse().map((r) => [r.circumference / (2 * Math.PI), r.position * height] as [number, number]), [0, 0]];
    const right = pts.map(([x, y]) => `${sx(x)},${sy(y)}`);
    const left = [...pts].reverse().map(([x, y]) => `${sx(-x)},${sy(y)}`);
    return `M${right.join("L")}L${left.join("L")}Z`;
  };

  const drawPumpkin = (s: number, look: Look) => {
    const failed = fit !== null && !fit.ok;
    // Gap highlight and ghost line (under everything else).
    const stops = [0, ...sorted().map((r) => r.position), 1];
    if (hoverGap !== null && !drag && stops[hoverGap + 1] !== undefined) {
      const lo = stops[hoverGap], hi = stops[hoverGap + 1];
      const yLo = sy(lo * height), yHi = sy(hi * height);
      const mid = (lo + hi) / 2;
      const rMid = radiusAt(mid);
      const g = el("g", { class: "bp-gap" });
      if (look.gap === "band") {
        const half = widest() * s + overhangPx(widest() * s);
        el("rect", { x: cx() - half, y: yHi, width: 2 * half, height: yLo - yHi, class: "bp-gap-fill", rx: 4 }, g);
      } else if (look.gap === "hatch") {
        // Only inside the outline: clip the hatch to it.
        el("path", { d: outlinePath() }, el("clipPath", { id: "bp-outline-clip" }, g));
        el("rect", { x: 0, y: yHi, width: svg.clientWidth, height: yLo - yHi, fill: "url(#bp-hatch)", "clip-path": "url(#bp-outline-clip)" }, g);
      } else {
        el("rect", { x: RULER_X, y: yHi, width: svg.clientWidth - RULER_X, height: yLo - yHi, class: "bp-gap-fill" }, g);
        el("line", { x1: RULER_X, y1: yHi, x2: svg.clientWidth, y2: yHi, class: "bp-gap-edge" }, g);
        el("line", { x1: RULER_X, y1: yLo, x2: svg.clientWidth, y2: yLo, class: "bp-gap-edge" }, g);
      }
      const rPx = rMid * s, oh = overhangPx(rPx), y = sy(mid * height);
      el("line", { x1: cx() - rPx - oh, y1: y, x2: cx() + rPx + oh, y2: y, class: "bp-ghost" }, g);
      const c = 2 * Math.PI * rMid;
      if (look.gap === "band") {
        el("circle", { cx: cx(), cy: y, r: 9, class: "bp-plus-bg" }, g);
        text(cx(), y + 1, "+", "bp-plus", "middle", g);
        text(cx() - rPx - oh - 8, y, circLabel(c, false), "bp-ghost-label", "end", g);
      } else if (look.gap === "hatch") {
        text(RULER_X + 8, y - 9, `+ add ring · ${fmtSnapped(c)}`, "bp-ghost-label", "start", g);
      } else {
        const bx = cx() + rPx + oh + 12;
        el("rect", { x: bx, y: y - 12, width: 118, height: 24, rx: 12, class: "bp-add-btn" }, g);
        text(bx + 59, y, `+ Add ring here`, "bp-add-label", "middle", g);
      }
    }

    el("path", { d: outlinePath(), class: failed ? "bp-outline bp-outline-failed" : "bp-outline" });

    // Height handle.
    const yTop = sy(height);
    const hg = el("g", { class: `bp-height ${drag?.kind === "height" ? "bp-active" : ""}` });
    if (look.heightHandle === "bar") {
      el("line", { x1: RULER_X, y1: yTop, x2: svg.clientWidth - 12, y2: yTop, class: "bp-height-line" }, hg);
      const hx = svg.clientWidth - 40;
      el("rect", { x: hx - 8, y: yTop - 8, width: 16, height: 16, class: "bp-handle-shape", rx: 2 }, hg);
      el("rect", { x: hx - 24, y: yTop - 14, width: 48, height: 28, class: "bp-hit", "data-hit": "height" }, hg);
      text(hx - 16, yTop - 16, `height ${drag?.kind === "height" ? fmt(height) : fmtSnapped(height)}`, "bp-height-label", "end", hg);
    } else if (look.heightHandle === "ruler") {
      el("line", { x1: RULER_X, y1: yTop, x2: cx(), y2: yTop, class: "bp-height-line" }, hg);
      el("path", { d: `M${RULER_X + 1},${yTop} l12,-8 v16 Z`, class: "bp-handle-shape" }, hg);
      el("rect", { x: RULER_X - 30, y: yTop - 14, width: 60, height: 28, class: "bp-hit", "data-hit": "height" }, hg);
      text(RULER_X + 18, yTop - 12, drag?.kind === "height" ? fmt(height) : fmtSnapped(height), "bp-height-label", "start", hg);
    } else {
      const half = (fit?.ok || failed ? widest() : 1) * s * 0.6 + 20;
      el("line", { x1: cx() - half, y1: yTop, x2: cx() + half, y2: yTop, class: "bp-height-line" }, hg);
      const label = `H ${drag?.kind === "height" ? fmt(height) : fmtSnapped(height)}`;
      el("rect", { x: cx() - 44, y: yTop - 24, width: 88, height: 22, rx: 11, class: "bp-handle-shape" }, hg);
      text(cx(), yTop - 13, label, "bp-pill-label", "middle", hg);
      el("rect", { x: cx() - 50, y: yTop - 28, width: 100, height: 36, class: "bp-hit", "data-hit": "height" }, hg);
    }

    // Rings.
    const blamed = failed && fit && !fit.ok ? rings[fit.ring]?.id : undefined;
    for (const r of sorted()) {
      const rPx = (r.circumference / (2 * Math.PI)) * s;
      const oh = overhangPx(rPx);
      const y = sy(r.position * height);
      const x1 = cx() - rPx - oh, x2 = cx() + rPx + oh;
      const isSel = selected === r.id;
      const dragging = drag?.kind === "ring" && drag.id === r.id;
      const g = el("g", { class: `bp-ring ${isSel ? "bp-selected" : ""} ${dragging ? "bp-active" : ""}`, "data-ring": r.id });
      el("line", { x1, y1: y, x2, y2: y, class: "bp-ring-line" }, g);
      el("line", { x1, y1: y, x2, y2: y, class: "bp-hit bp-hit-line", "data-hit": "select" }, g);
      const label = circLabel(r.circumference, dragging);
      if (look.label === "line") {
        text(x1 - 8, y, label, "bp-ring-label", "end", g).setAttribute("data-hit", "select");
      } else if (look.label === "ruler") {
        text(RULER_X + 8, y - 8, label, "bp-ring-label", "start", g).setAttribute("data-hit", "select");
        el("line", { x1: RULER_X, y1: y, x2: x1, y2: y, class: "bp-leader" }, g);
        if (dragging) text(RULER_X + 8, y + 9, `at ${fmt(r.position * height)}`, "bp-ring-sub", "start", g);
      } else {
        const w = label.length * 7 + 14;
        el("rect", { x: x1 - w - 6, y: y - 11, width: w, height: 22, rx: 4, class: "bp-chip", "data-hit": "select" }, g);
        text(x1 - 6 - w / 2, y, label, "bp-chip-label", "middle", g).setAttribute("data-hit", "select");
      }
      // Handle.
      if (look.handle === "dot") {
        el("circle", { cx: x2, cy: y, r: look.handleSize / 2, class: "bp-handle-shape" }, g);
      } else if (look.handle === "tab") {
        el("path", { d: `M${x2},${y} l${look.handleSize},-${look.handleSize * 0.7} v${look.handleSize * 1.4} Z`, class: "bp-handle-shape" }, g);
      } else {
        const readout = dragging ? `${fmt(r.position * height)} ↑` : "⇔ ⇕";
        el("rect", { x: x2, y: y - 11, width: 64, height: 22, rx: 11, class: "bp-handle-shape" }, g);
        text(x2 + 32, y, readout, "bp-pill-label", "middle", g);
      }
      const hitX = look.handle === "pill" ? x2 + 32 : look.handle === "tab" ? x2 + look.handleSize / 2 : x2;
      el("circle", { cx: hitX, cy: y, r: look.handle === "pill" ? 32 : look.hit, class: "bp-hit", "data-hit": "handle" }, g);
      if (dragging && look.handle !== "pill") {
        text(x2 + look.handleSize + 8, y - 12, `at ${fmt(r.position * height)}`, "bp-drag-readout", "start", g);
      }
      if (isSel && rings.length > 1) {
        const xx = look.label === "chip" ? cx() : cx();
        const xy = look.gap === "hatch" ? y - 14 : y;
        el("circle", { cx: xx, cy: xy, r: look.gap === "hatch" ? 8 : 10, class: "bp-x-bg", "data-hit": "delete" }, g);
        text(xx, xy + 1, "×", "bp-x", "middle", g).setAttribute("data-hit", "delete");
      }
      if (r.id === blamed && look.warn === "inline") {
        text(x2 + 20, y + 14, "⚠ no smooth shape through this ring", "bp-inline-warn", "start", g);
      }
    }
    showWarn(failed ? "No smooth pumpkin shape passes through these rings. Check their heights and circumferences. (Edits still apply; a later edit may fix it.)" : null);
  };

  const drawBall = (s: number) => {
    const c = rings[0]?.circumference ?? 0;
    const r = c / (2 * Math.PI);
    if (!(r > 0)) return;
    const look = LOOKS[variant];
    el("circle", { cx: cx(), cy: sy(r), r: r * s, class: "bp-outline" });
    const rPx = r * s, oh = overhangPx(rPx), y = sy(r);
    const dragging = drag?.kind === "ball";
    const g = el("g", { class: `bp-ring ${dragging ? "bp-active" : ""}`, "data-ring": rings[0].id });
    el("line", { x1: cx() - rPx - oh, y1: y, x2: cx() + rPx + oh, y2: y, class: "bp-ring-line" }, g);
    text(cx() - rPx - oh - 8, y, circLabel(c, dragging), "bp-ring-label", "end", g);
    el("circle", { cx: cx() + rPx + oh, cy: y, r: look.handleSize / 2 + 1, class: "bp-handle-shape" }, g);
    el("circle", { cx: cx() + rPx + oh, cy: y, r: look.hit + 4, class: "bp-hit", "data-hit": "ball" }, g);
  };

  const showWarn = (msg: string | null) => {
    const look = LOOKS[variant];
    warnBox.hidden = msg === null || look.warn === "inline";
    warnBox.dataset.kind = look.warn;
    warnBox.textContent = msg ?? "";
  };

  const renderZoom = () => {
    const look = LOOKS[variant];
    zoomBox.dataset.kind = look.zoomUi;
    const pct = `${Math.round(zoom * 100)}%`;
    if (look.zoomUi === "stack") {
      zoomBox.innerHTML = `<button data-z="in" title="Zoom in (+)">+</button><button data-z="out" title="Zoom out (−)">−</button><button data-z="fit" title="Fit">⤢</button>`;
    } else if (look.zoomUi === "pill") {
      zoomBox.innerHTML = `<button data-z="out">−</button><span>${pct}</span><button data-z="in">+</button><button data-z="fit">Fit</button>`;
    } else {
      zoomBox.innerHTML = `<span>¼×</span><input type="range" min="${MIN_ZOOM}" max="1" step="0.01" value="${zoom}" /><span>1×</span><button data-z="fit">Fit</button>`;
      zoomBox.querySelector("input")!.addEventListener("input", (e) => setZoom(Number((e.target as HTMLInputElement).value)));
    }
    for (const b of zoomBox.querySelectorAll<HTMLButtonElement>("button")) {
      if (b.dataset.z === "in") b.disabled = zoom >= 1;
      if (b.dataset.z === "out") b.disabled = zoom <= MIN_ZOOM;
      b.disabled ||= b.dataset.z === "fit" && zoom === 1;
    }
  };
  zoomBox.addEventListener("click", (e) => {
    const z = (e.target as HTMLElement).closest<HTMLElement>("[data-z]")?.dataset.z;
    if (z === "in") setZoom(zoom * 1.25);
    if (z === "out") setZoom(zoom / 1.25);
    if (z === "fit") setZoom(1);
  });
  const setZoom = (z: number) => {
    zoom = Math.min(1, Math.max(MIN_ZOOM, z));
    render();
  };

  // --- interaction --------------------------------------------------------------------------------------------
  const ringById = (id: number) => rings.find((r) => r.id === id)!;
  const local = (e: PointerEvent | MouseEvent) => {
    const b = svg.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  /** The gap (index into [0, …positions, 1]) under a screen y, or null outside the pumpkin or too tight. */
  const gapAt = (y: number): number | null => {
    if (!valid() || ball) return null;
    const p = (baseY() - y) / scale() / height;
    if (!(p > 0 && p < 1)) return null;
    const stops = [0, ...sorted().map((r) => r.position), 1];
    for (let i = 0; i + 1 < stops.length; i++) {
      if (p >= stops[i] && p <= stops[i + 1]) return (stops[i + 1] - stops[i]) * height >= 2 * minGap() ? i : null;
    }
    return null;
  };

  svg.addEventListener("pointerdown", (e) => {
    svg.focus();
    const target = e.target as Element;
    const hit = target.closest("[data-hit]")?.getAttribute("data-hit");
    const ringId = Number(target.closest("[data-ring]")?.getAttribute("data-ring"));
    const { x, y } = local(e);
    if (hit === "handle") {
      const r = ringById(ringId);
      const s = sorted(), i = s.indexOf(r);
      const gap = minGap() / height;
      drag = { kind: "ring", id: r.id, x0: x, y0: y, r0: r.circumference / (2 * Math.PI), p0: r.position, lo: (s[i - 1]?.position ?? 0) + gap, hi: (s[i + 1]?.position ?? 1) - gap, axis: null };
      selected = r.id;
    } else if (hit === "height") {
      const s = sorted();
      let tightest = Infinity;
      [0, ...s.map((r) => r.position), 1].forEach((p, i, a) => i > 0 && (tightest = Math.min(tightest, p - a[i - 1])));
      drag = { kind: "height", y0: y, h0: height, s0: scale(), hMin: Math.max(cm(2) / 1, minGap() / tightest) };
    } else if (hit === "ball") {
      drag = { kind: "ball", x0: x, r0: (rings[0]?.circumference ?? 0) / (2 * Math.PI) };
    } else if (hit === "select") {
      selected = ringId;
    } else if (hit === "delete") {
      requestDelete();
      return;
    } else {
      const gap = gapAt(y);
      if (gap !== null) addRingInGap(gap);
      else selected = null;
    }
    if (drag) {
      svg.setPointerCapture(e.pointerId);
      // Freeze the scale for the whole drag (any handle), refitting on release.
      if (freeze) frozenFit = fitScale();
    }
    hideConfirm();
    render();
  });

  let frame = 0;
  svg.addEventListener("pointermove", (e) => {
    const { x, y } = local(e);
    if (!drag) {
      const overRing = (e.target as Element).closest("[data-hit]");
      const g = overRing ? null : gapAt(y);
      if (g !== hoverGap) {
        hoverGap = g;
        render();
      }
      svg.style.cursor = overRing?.getAttribute("data-hit") === "handle" ? "grab" : overRing?.getAttribute("data-hit") === "height" ? "ns-resize" : g !== null ? "copy" : "";
      return;
    }
    const free = e.altKey;
    const look = LOOKS[variant];
    if (drag.kind === "ring") {
      const r = ringById(drag.id);
      let dx = x - drag.x0, dy = y - drag.y0;
      if (look.axisLock) {
        if (!drag.axis && Math.hypot(dx, dy) > 6) drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (drag.axis === "x") dy = 0;
        else if (drag.axis === "y") dx = 0;
        else dx = dy = 0;
      }
      const s = scale();
      // Keep the handle under the pointer: handle x = r·s·(1 + a) + b past the middle.
      const handlePx = drag.r0 * s * (1 + look.overhang.a) + dx;
      const radius = handlePx / s / (1 + look.overhang.a);
      r.circumference = clampCirc(snap(2 * Math.PI * radius, free));
      const above = snap(drag.p0 * height - dy / s, free);
      r.position = Math.min(drag.hi, Math.max(drag.lo, above / height));
    } else if (drag.kind === "height") {
      const h = snap(drag.h0 + (drag.y0 - y) / drag.s0, free);
      height = Math.min(cm(100), Math.max(drag.hMin, h));
    } else {
      const s = scale();
      const radius = drag.r0 + (x - drag.x0) / s / (1 + look.overhang.a);
      rings[0].circumference = clampCirc(snap(2 * Math.PI * radius, free));
    }
    // Coalesce refits to one per frame.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      refit();
      render();
    });
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    if (frozenFit !== null) {
      // Refit on release, tweening the scale so the jump reads as a zoom.
      const from = frozenFit;
      frozenFit = null;
      const to = targetFit();
      const t0 = performance.now();
      cancelAnimationFrame(tween);
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 220);
        shownFit = from + (to - from) * (1 - (1 - k) ** 3);
        render();
        if (k < 1) tween = requestAnimationFrame(step);
        else {
          shownFit = null;
          render();
        }
      };
      step();
    } else {
      refit();
      render();
    }
    commit();
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("pointerleave", () => {
    if (!drag && hoverGap !== null) {
      hoverGap = null;
      render();
    }
  });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  svg.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") setZoom(zoom * 1.25);
    else if (e.key === "-" || e.key === "_") setZoom(zoom / 1.25);
    else if (e.key === "Escape") {
      selected = null;
      hideConfirm();
      render();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) deleteSelected();
    else if (e.key.startsWith("Arrow") && selected !== null && !ball) {
      const r = ringById(selected);
      const stepBy = snapStep() * (e.shiftKey ? 8 : 1);
      const s = sorted(), i = s.indexOf(r), gap = minGap() / height;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const p = (Math.round((r.position * height) / snapStep()) * snapStep() + (e.key === "ArrowUp" ? stepBy : -stepBy)) / height;
        r.position = Math.min((s[i + 1]?.position ?? 1) - gap, Math.max((s[i - 1]?.position ?? 0) + gap, p));
      } else {
        r.circumference = clampCirc(snap(r.circumference, false) + (e.key === "ArrowRight" ? stepBy : -stepBy));
      }
      refit();
      render();
      clearTimeout(commitTimer);
      commitTimer = window.setTimeout(commit, 250);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  const addRingInGap = (gap: number) => {
    const stops = [0, ...sorted().map((r) => r.position), 1];
    const position = (stops[gap] + stops[gap + 1]) / 2;
    const ring = { id: nextId++, position, circumference: 2 * Math.PI * radiusAt(position) };
    rings.push(ring);
    selected = ring.id;
    hoverGap = null;
    refit();
    commit();
  };

  const requestDelete = () => {
    if (rings.length <= 1) return;
    if (!askBeforeDelete) return deleteSelected();
    const r = ringById(selected!);
    const y = sy(r.position * height);
    confirmBox.style.left = `${cx() - 90}px`;
    confirmBox.style.top = `${y + 18}px`;
    confirmBox.hidden = false;
    confirmBox.querySelector<HTMLButtonElement>(".bp-yes")!.focus();
  };
  const hideConfirm = () => (confirmBox.hidden = true);
  confirmBox.querySelector(".bp-yes")!.addEventListener("click", () => {
    if (confirmBox.querySelector<HTMLInputElement>(".bp-dont-ask")!.checked) askBeforeDelete = false;
    hideConfirm();
    deleteSelected();
  });
  confirmBox.querySelector(".bp-no")!.addEventListener("click", () => {
    hideConfirm();
    svg.focus();
  });
  const deleteSelected = () => {
    if (selected === null || rings.length <= 1) return;
    rings = rings.filter((r) => r.id !== selected);
    selected = null;
    refit();
    render();
    commit();
    svg.focus();
  };

  const commit = () => {
    lastCommit = new Date().toLocaleTimeString();
    onCommit({ height, rings: rings.map(({ position, circumference }) => ({ position, circumference })) });
  };

  // --- prototype chrome: variant switcher bar and state panel -------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "proto-bar";
  bar.innerHTML = `
    <button class="proto-prev" title="Previous variant (←)">◀</button>
    <span class="proto-label"></span>
    <button class="proto-next" title="Next variant (→)">▶</button>
    <label title="Freeze the scale while dragging any handle; refit on release"><input type="checkbox" class="proto-freeze" /> freeze scale while dragging</label>
    <button class="proto-fail" title="Load rings the fitter rejects">load failing rings</button>
    <button class="proto-state-toggle">state</button>
  `;
  const statePanel = document.createElement("pre");
  statePanel.className = "proto-state";
  statePanel.hidden = true;
  if (import.meta.env.DEV) document.body.append(bar, statePanel);
  const freezeBox = bar.querySelector<HTMLInputElement>(".proto-freeze")!;
  const setVariant = (v: VariantKey) => {
    variant = v;
    freeze = LOOKS[v].freeze;
    const url = new URL(location.href);
    url.searchParams.set("variant", v);
    history.replaceState(null, "", url);
    bar.querySelector(".proto-label")!.textContent = `${v} (${LOOKS[v].name})`;
    freezeBox.checked = freeze;
    render();
  };
  const cycle = (d: number) => {
    const keys: VariantKey[] = ["A", "B", "C"];
    setVariant(keys[(keys.indexOf(variant) + d + keys.length) % keys.length]);
  };
  bar.querySelector(".proto-prev")!.addEventListener("click", () => cycle(-1));
  bar.querySelector(".proto-next")!.addEventListener("click", () => cycle(1));
  freezeBox.addEventListener("change", () => (freeze = freezeBox.checked));
  bar.querySelector(".proto-state-toggle")!.addEventListener("click", () => {
    statePanel.hidden = !statePanel.hidden;
    renderState();
  });
  bar.querySelector(".proto-fail")!.addEventListener("click", () => {
    // A barrel: equal rings just inside the top and bottom. No smooth shape is that wide that close to the poles.
    const c = rings.reduce((m, r) => Math.max(m, r.circumference), 0) || 30;
    const edge = Math.max(0.04, (minGap() * 1.01) / height);
    rings = [
      { id: nextId++, position: 1 - edge, circumference: c },
      { id: nextId++, position: edge, circumference: c },
    ];
    refit();
    render();
    commit();
  });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || !(e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    const t = e.target as Element;
    if (t === svg || t.closest("input, textarea, select, [contenteditable]")) return;
    cycle(e.key === "ArrowLeft" ? -1 : 1);
  });

  function renderState() {
    if (statePanel.hidden) return;
    const lines = [
      `variant ${variant} (${LOOKS[variant].name})  freeze=${freeze}  axisLock=${LOOKS[variant].axisLock}`,
      `zoom ${zoom.toFixed(2)}×  scale ${scale().toFixed(1)} px/${units}${frozenFit !== null ? "  (frozen)" : ""}`,
      `mode ${ball ? "ball" : "pumpkin"}  height ${fmt(height, 3)}`,
      `fit ${fit === null ? "—" : fit.ok ? "ok" : `FAILED (blames ring #${fit.ring})`}  ${fitMs.toFixed(1)} ms`,
      `selected ${selected ?? "—"}  hoverGap ${hoverGap ?? "—"}  askBeforeDelete ${askBeforeDelete}`,
      `drag ${drag ? drag.kind + ("axis" in drag ? ` axis=${drag.axis ?? "?"}` : "") : "—"}  last commit ${lastCommit || "—"}`,
      `rings (top → bottom):`,
      ...[...sorted()].reverse().map((r) => `  #${r.id}${r.id === selected ? "*" : " "} at ${fmt(r.position * height, 3)} (${r.position.toFixed(3)})  C ${fmt(r.circumference, 3)}`),
    ];
    statePanel.textContent = lines.join("\n");
  }

  new ResizeObserver(() => render()).observe(svg);
  setVariant(variant);

  return {
    sync(m, isBall) {
      if (drag) return;
      units = m.units;
      ball = isBall;
      height = m.height;
      const incoming = m.rings.filter((r) => Number.isFinite(r.position) && Number.isFinite(r.circumference));
      const keepIds = incoming.length === rings.length;
      rings = incoming.map((r, i) => ({ id: keepIds ? rings[i].id : nextId++, position: r.position, circumference: r.circumference }));
      if (selected !== null && !rings.some((r) => r.id === selected)) selected = null;
      refit();
      render();
    },
  };
}

function injectStyle() {
  const style = document.createElement("style");
  style.textContent = `
  @media not (min-width: 60rem) { .view-blueprint { position: relative; aspect-ratio: 4 / 3; } }
  .view-blueprint { overflow: hidden; --bp-bg: var(--bg); --bp-line: var(--fg); --bp-muted: var(--muted);
    --bp-accent: var(--accent); --bp-outline: var(--fg); --bp-gap: rgb(226 106 18 / 0.10); --bp-panel: var(--card); }
  .bp-svg { position: absolute; inset: 0; width: 100%; height: 100%; background: var(--bp-bg); outline: none; touch-action: none;
    font: 12px system-ui, sans-serif; user-select: none; }
  .bp-svg:focus-visible { box-shadow: inset 0 0 0 2px var(--bp-accent); }
  .bp-ruler-line, .bp-tick { stroke: var(--bp-muted); stroke-width: 1; }
  .bp-tick-major { stroke: var(--bp-line); }
  .bp-ruler-label, .bp-ruler-units { fill: var(--bp-muted); font-size: 11px; }
  .bp-outline { fill: none; stroke: var(--bp-outline); stroke-width: 1.5; }
  .bp-outline-failed { stroke-dasharray: 6 5; stroke: var(--warn-fg); }
  .bp-ring-line { stroke: var(--bp-line); stroke-width: 1.5; }
  .bp-hit { fill: transparent; stroke: transparent; cursor: pointer; }
  .bp-hit-line { stroke-width: 12; }
  .bp-handle-shape { fill: var(--bp-bg); stroke: var(--bp-line); stroke-width: 1.5; }
  .bp-ring-label, .bp-height-label, .bp-ghost-label, .bp-drag-readout, .bp-ring-sub { fill: var(--bp-line); cursor: pointer; }
  .bp-ghost-label { fill: var(--bp-muted); }
  .bp-drag-readout, .bp-ring-sub { fill: var(--bp-muted); font-size: 11px; }
  .bp-selected .bp-ring-line { stroke: var(--bp-accent); stroke-width: 3; }
  .bp-selected .bp-handle-shape { stroke: var(--bp-accent); fill: var(--bp-accent); }
  .bp-selected .bp-ring-label { fill: var(--bp-accent); font-weight: 600; }
  .bp-active .bp-handle-shape { fill: var(--bp-accent); }
  .bp-x-bg { fill: var(--bp-accent); cursor: pointer; }
  .bp-x { fill: #fff; font-size: 15px; font-weight: 700; pointer-events: none; }
  .bp-height-line { stroke: var(--bp-muted); stroke-dasharray: 2 4; }
  .bp-active .bp-height-line { stroke: var(--bp-accent); stroke-dasharray: none; }
  .bp-gap-fill { fill: var(--bp-gap); }
  .bp-gap-edge { stroke: var(--bp-accent); stroke-opacity: 0.35; }
  .bp-hatch-line { stroke: var(--bp-accent); stroke-opacity: 0.35; stroke-width: 2; }
  .bp-ghost { stroke: var(--bp-accent); stroke-dasharray: 5 4; stroke-width: 1.5; }
  .bp-plus-bg { fill: var(--bp-accent); } .bp-plus { fill: #fff; font-weight: 700; font-size: 14px; pointer-events: none; }
  .bp-leader { stroke: var(--bp-muted); stroke-dasharray: 1 3; }
  .bp-chip { fill: var(--bp-panel); stroke: var(--bp-muted); cursor: pointer; }
  .bp-selected .bp-chip { stroke: var(--bp-accent); stroke-dasharray: 3 2; stroke-width: 1.5; }
  .bp-chip-label, .bp-pill-label { fill: var(--bp-line); font-size: 11px; pointer-events: none; }
  .bp-add-btn { fill: var(--bp-accent); } .bp-add-label { fill: #fff; font-weight: 600; pointer-events: none; }
  .bp-inline-warn { fill: var(--warn-fg); font-size: 11px; }

  .bp-A { --bp-bg: #123a63; --bp-line: #e6f1ff; --bp-muted: #8fb3d9; --bp-accent: #ffd166; --bp-outline: #7fd3ff;
    --bp-gap: rgb(255 209 102 / 0.14); --bp-panel: #0e2f50; }
  .bp-A .bp-svg { background-image: linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px); background-size: 24px 24px; }
  .bp-A .bp-x { fill: #123a63; } .bp-A .bp-plus { fill: #123a63; }
  .bp-B .bp-outline { stroke-width: 1; } .bp-B .bp-ring-line { stroke-width: 1; }
  .bp-B .bp-selected .bp-ring-line { stroke-width: 2; filter: drop-shadow(0 0 3px var(--bp-accent)); }
  .bp-C { --bp-bg: #1f2328; --bp-line: #e8e8e8; --bp-muted: #8b949e; --bp-accent: #4cc2ff; --bp-outline: #c9d1d9;
    --bp-gap: rgb(76 194 255 / 0.10); --bp-panel: #2d333b; }
  .bp-C .bp-ring-line { stroke-width: 3; } .bp-C .bp-selected .bp-ring-line { stroke-width: 4; }
  .bp-C .bp-outline { stroke-width: 2; }
  .bp-C .bp-handle-shape { fill: #2d333b; } .bp-C .bp-selected .bp-handle-shape, .bp-C .bp-active .bp-handle-shape { fill: #0b5f8a; }
  .bp-C .bp-x { fill: #1f2328; }

  .bp-zoom { position: absolute; display: flex; gap: 4px; align-items: center; z-index: 1; color: var(--bp-line); font-size: 12px; }
  .bp-zoom button { min-width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--bp-muted); background: var(--bp-panel);
    color: var(--bp-line); cursor: pointer; font-size: 15px; }
  .bp-zoom button:disabled { opacity: 0.4; cursor: default; }
  .bp-zoom[data-kind="stack"] { right: 12px; bottom: 48px; flex-direction: column; }
  .bp-zoom[data-kind="pill"] { right: 12px; top: 8px; background: var(--bp-panel); border: 1px solid var(--border); border-radius: 999px; padding: 2px 6px; }
  .bp-zoom[data-kind="pill"] button { border: 0; background: none; font-size: 13px; }
  .bp-zoom[data-kind="slider"] { left: 52px; bottom: 8px; background: var(--bp-panel); border-radius: 6px; padding: 4px 8px; }
  .bp-zoom[data-kind="slider"] button { font-size: 12px; }
  .bp-warn { position: absolute; z-index: 1; font-size: 13px; color: var(--warn-fg); background: var(--warn-bg); }
  .bp-warn[hidden] { display: none; }
  .bp-warn[data-kind="banner"] { top: 44px; left: 56px; right: 12px; padding: 6px 10px; border-left: 3px solid var(--warn-fg); }
  .bp-warn[data-kind="toast"] { bottom: 52px; left: 50%; transform: translateX(-50%); max-width: 70%; padding: 8px 12px;
    border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / 0.4); }
  .bp-confirm { position: absolute; z-index: 2; width: 180px; padding: 8px 10px; background: var(--card); color: var(--fg);
    border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / 0.3); font-size: 13px; display: grid; gap: 6px; }
  .bp-confirm[hidden] { display: none; }
  .bp-confirm-buttons { display: flex; gap: 6px; }

  .proto-bar { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex; gap: 8px;
    align-items: center; padding: 6px 12px; border-radius: 999px; background: #111; color: #fff; font: 13px system-ui;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.45); border: 2px dashed #f0f; }
  .proto-bar button { background: #333; color: #fff; border: 0; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
  .proto-label { min-width: 150px; text-align: center; font-weight: 600; }
  .proto-state { position: fixed; bottom: 60px; right: 12px; z-index: 100; margin: 0; padding: 8px 10px; max-width: 460px;
    background: rgb(0 0 0 / 0.85); color: #9f9; font: 11px ui-monospace, monospace; border-radius: 6px; pointer-events: none; }
  .proto-state[hidden] { display: none; }
  `;
  document.head.append(style);
}
