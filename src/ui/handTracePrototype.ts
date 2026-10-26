/**
 * PROTOTYPE — throwaway, for "Placing and dragging handles on a phone" (issue #21, map #4), extending the touch
 * prototype of "Placing and adjusting points on a phone" (#14). Not production code: no tests, no a11y, minimal
 * error handling. Lives on the `prototype/hand-trace-handles` branch only.
 *
 * #14 chose its modeless model (variant B there): tap places, hold for a loupe, drag pans, a floating pill offers
 * what fits the state. This adds curves as "Curves in v1" (#19) decided them: corner and smooth points, handles stored
 * as offsets, automatic handles on a smooth point until one is dragged, Smooth / Corner in the pill, a double-tap on a
 * point to toggle, a handle dragged back onto its point removed, a symmetric shape's smooth axis point holding its
 * handle at right angles to the axis.
 *
 * The variants (`?variant=A|B|C`, the floating bar, ← →) are presets of the two biggest open choices; ⚙ mixes them:
 * - A "Selected point only": only the selected point's handles show; a corner gets handles by Smooth, then Corner.
 * - B "Neighbours + stubs": the selected point's handles, plus its neighbours' handles on the same two edges; a
 *   selected corner shows stubs to pull a handle out of.
 * - C "Whole shape + pill": every handle on the selected shape, point or shape selected; a "+ Handles" pill action
 *   gives a corner handles along its edges, to drag from there.
 * ⚙ also sets hit priority between handles and points, the loupe on handle drags, and the double-tap window.
 * B was chosen. Placed points are always corners (a "Curves" setting placing smooth points was tried and dropped: the
 * shape isn't known until it's closed). A point inserted on a curve is a corner with no handles (chosen); ⚙ "New
 * point on a curve" swaps back to a smooth point that splits the curve exactly. "Demo" in the bar loads curved shapes as if imported (a round
 * eye, a crescent with corner tips, a symmetric smile) to try the handles on straight away. Shapes are drawn with
 * corner points as squares and smooth points as circles.
 *
 * Not as decided, to keep it small: deleting a point keeps its neighbours' handles instead of refitting; an edge
 * joining a symmetric shape's off-axis end to its reflection has no insert marker; moving a point doesn't clamp its
 * handle tips. Points are in the photo's pixels (y down), not the real design space.
 */

type Pt = { x: number; y: number };
type Kind = "corner" | "smooth";
type Side = "in" | "out";
/** A placed point. Handles are offsets from it; a side without one is straight, or automatic on a smooth point. */
interface Anchor {
  x: number;
  y: number;
  kind: Kind;
  in?: Pt;
  out?: Pt;
}
type Mirror = "none" | "twin" | "symmetric";
interface Shape {
  id: number;
  points: Anchor[];
  closed: boolean;
  mirror: Mirror;
}
type VariantKey = "A" | "B" | "C";
type Selection = { kind: "point"; id: number; index: number } | { kind: "shape"; id: number } | null;

/** For each side of a drawn node: the source point's handle it shows, and whether reflected. */
type SideMap = Record<Side, { side: Side; mirror: boolean }>;
/** A point as drawn on screen: a placed point, or its reflection. */
interface Dot {
  p: Pt;
  id: number;
  index: number;
  reflected: boolean;
}
/** An outline node as drawn, with its handles as they act (automatic ones worked out, reflections reflected). */
interface ONode extends Dot {
  kind: Kind;
  in?: Pt;
  out?: Pt;
  map: SideMap;
}
interface Outline {
  nodes: ONode[];
  closed: boolean;
}
/** A segment as drawn; inserting on it splits source segment `insertAt` (-1: a join, no marker). */
interface Edge {
  a: Pt;
  c1: Pt;
  c2: Pt;
  b: Pt;
  id: number;
  insertAt: number;
}
interface Geo {
  outlines: Outline[];
  edges: Edge[];
}
/** A handle as drawn, or a stub to pull one out of a corner, with the source handle it edits. */
interface Knob {
  base: Pt;
  tip: Pt;
  id: number;
  index: number;
  side: Side;
  mirror: boolean;
  stub: boolean;
  /** The selected point's own handle (or any, with a whole shape selected), not a neighbour's. */
  own: boolean;
}
type Hit =
  | { kind: "point"; d: ONode }
  | { kind: "knob"; k: Knob }
  | { kind: "marker"; e: Edge }
  | { kind: "shape"; id: number; reflected: boolean }
  | { kind: "empty" };

interface Action {
  loupe: boolean;
  /** The design point the loupe centres on. */
  focus(): Pt | null;
  move(p: Pt): void;
  end(p: Pt): void;
  cancel(): void;
}
interface OneGesture {
  type: "one";
  id: number;
  start: Pt;
  last: Pt;
  hit: Hit;
  active: Action | null;
  timer?: number;
  t0: number;
}
interface MultiGesture {
  type: "multi";
  t0: number;
  max: number;
  moved: boolean;
  prev: { c: Pt; d: number } | null;
}
/** The first tap of a possible double-tap, with the state from before it so a double-tap can take it back. */
interface TapRecord {
  t: number;
  at: Pt;
  dot: Dot | null;
  shapes: string;
  drawingId: number | null;
  undo: number;
  redo: string[];
}

type Show = "point" | "neighbours" | "shape";
type Pull = "smooth" | "stub" | "pill";
type Priority = "nearest" | "handles" | "points";
type Split = "smooth" | "corner";
interface Tuning {
  /** Hit radius on screen, px. */
  hit: number;
  /** Loupe magnification over the current zoom. */
  zoom: number;
  /** Touch-and-hold before the loupe shows, ms. */
  hold: number;
  /** Loupe diameter, px. */
  loupe: number;
  /** Which handles show. */
  show: Show;
  /** How a handle is pulled out of a corner that has none. */
  pull: Pull;
  /** Which wins when a handle and a point are both in reach. */
  priority: Priority;
  /** A point inserted on a curve: smooth, splitting it exactly, or a corner without handles. */
  split: Split;
  /** The loupe on handle drags. */
  hloupe: boolean;
  /** Double-tap window, ms; 0 turns double-tap off. */
  dbl: number;
  showHits: boolean;
}

const VARIANTS: Record<VariantKey, { name: string; show: Show; pull: Pull }> = {
  A: { name: "Selected point only", show: "point", pull: "smooth" },
  B: { name: "Neighbours + stubs", show: "neighbours", pull: "stub" },
  C: { name: "Whole shape + pill", show: "shape", pull: "pill" },
};
const KEYS = Object.keys(VARIANTS) as VariantKey[];
const SHOWS: readonly Show[] = ["point", "neighbours", "shape"];
const PULLS: readonly Pull[] = ["smooth", "stub", "pill"];
const PRIORITIES: readonly Priority[] = ["nearest", "handles", "points"];
const SPLITS: readonly Split[] = ["smooth", "corner"];
const SIDES: readonly Side[] = ["in", "out"];
const DEFAULTS = { hit: 22, zoom: 3, hold: 300, loupe: 130, priority: "nearest" as Priority, dbl: 300 };
const SLOP = 9;
const TAP_MS = 350;
const MAX_PHOTO = 2400;
const UNDO_DEPTH = 200;
/** A handle dragged within this many screen px of its point is removed. */
const RETRACT = 10;
/** How far out a stub sits from its corner, screen px. */
const STUB = 40;
const ZERO: Pt = { x: 0, y: 0 };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => (len(a) > 1e-9 ? scale(a, 1 / len(a)) : { x: 0, y: 0 });
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const opposite = (s: Side): Side => (s === "in" ? "out" : "in");
/** A handle offset as seen in the reflection. */
const reflOff = (o: Pt | undefined): Pt | undefined => o && { x: -o.x, y: o.y };
const f = (n: number) => n.toFixed(1);
const bez = (e: Edge, t: number): Pt => {
  const u = 1 - t;
  const [k0, k1, k2, k3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: k0 * e.a.x + k1 * e.c1.x + k2 * e.c2.x + k3 * e.b.x, y: k0 * e.a.y + k1 * e.c1.y + k2 * e.c2.y + k3 * e.b.y };
};
const curved = (e: Edge) => dist(e.a, e.c1) > 1e-6 || dist(e.b, e.c2) > 1e-6;
/** A segment as a polyline, in whatever mapping. */
const flat = (e: Edge, map: (p: Pt) => Pt = (p) => p): Pt[] =>
  curved(e) ? Array.from({ length: 17 }, (_, i) => map(bez(e, i / 16))) : [map(e.a), map(e.b)];
/** Set a handle, or remove it when absent or of no length. */
function setOff(a: Anchor, side: Side, o: Pt | undefined): void {
  if (o && len(o) > 1e-6) a[side] = o;
  else delete a[side];
}

export function mountHandTracePrototype(root: HTMLElement): void {
  injectStyle();
  const params = new URLSearchParams(location.search);
  let variant: VariantKey = KEYS.find((k) => k === params.get("variant")) ?? "B";
  const pick = <T extends string>(key: string, options: readonly T[], fallback: T): T =>
    options.find((o) => o === params.get(key)) ?? fallback;
  const tuning: Tuning = {
    hit: Number(params.get("hit")) || DEFAULTS.hit,
    zoom: Number(params.get("zoom")) || DEFAULTS.zoom,
    hold: Number(params.get("hold")) || DEFAULTS.hold,
    loupe: Number(params.get("loupe")) || DEFAULTS.loupe,
    show: pick("show", SHOWS, VARIANTS[variant].show),
    pull: pick("pull", PULLS, VARIANTS[variant].pull),
    priority: pick("priority", PRIORITIES, DEFAULTS.priority),
    split: pick("split", SPLITS, "corner"),
    hloupe: params.get("hloupe") !== "0",
    dbl: params.has("dbl") ? Number(params.get("dbl")) : DEFAULTS.dbl,
    showHits: params.get("showHits") === "1",
  };
  let full = true;

  root.innerHTML = `
    <div class="ht-root">
      <svg class="ht-svg">
        <g class="ht-photo"><image id="ht-photo-img" preserveAspectRatio="none" /></g>
        <g class="ht-over"></g>
      </svg>
      <div class="ht-loupe" hidden>
        <svg><g class="ht-lphoto"><use href="#ht-photo-img" /></g><g class="ht-lover"></g></svg>
        <div class="ht-loupe-cross"></div>
      </div>
      <div class="ht-note" hidden></div>
      <div class="ht-ui"></div>
    </div>
  `;
  const bar = document.createElement("div");
  bar.className = "ht-proto-bar";
  const stateEl = document.createElement("div");
  stateEl.className = "ht-state";
  const tuneEl = document.createElement("div");
  tuneEl.className = "ht-tune";
  tuneEl.hidden = true;
  document.body.append(bar, stateEl, tuneEl);

  const htRoot = root.querySelector<HTMLElement>(".ht-root")!;
  const svg = root.querySelector<SVGSVGElement>(".ht-svg")!;
  const photoG = root.querySelector<SVGGElement>(".ht-photo")!;
  const photoImg = root.querySelector<SVGImageElement>("#ht-photo-img")!;
  const overG = root.querySelector<SVGGElement>(".ht-over")!;
  const loupeEl = root.querySelector<HTMLElement>(".ht-loupe")!;
  const loupeSvg = loupeEl.querySelector("svg")!;
  const lPhotoG = loupeEl.querySelector<SVGGElement>(".ht-lphoto")!;
  const lOverG = loupeEl.querySelector<SVGGElement>(".ht-lover")!;
  const noteEl = root.querySelector<HTMLElement>(".ht-note")!;
  const uiEl = root.querySelector<HTMLElement>(".ht-ui")!;

  // ---- Model ----------------------------------------------------------------------------------------------
  let W = 1;
  let H = 1;
  let shapes: Shape[] = [];
  let nextId = 1;
  let drawingId: number | null = null;
  let selection: Selection = null;
  let symmetry = false;
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  const logLines: string[] = [];
  let showDetail = false;
  let lastTap: TapRecord | null = null;

  // Transient display state.
  let preview: Pt | null = null;
  let axisHot = false;

  const view = { s: 1, tx: 0, ty: 0 };
  let userMoved = false;
  const toScreen = (p: Pt): Pt => ({ x: p.x * view.s + view.tx, y: p.y * view.s + view.ty });
  const toDesign = (p: Pt): Pt => ({ x: (p.x - view.tx) / view.s, y: (p.y - view.ty) / view.s });
  const size = () => ({ w: svg.clientWidth, h: svg.clientHeight });

  const ax = () => W / 2;
  const reflect = (p: Pt): Pt => ({ x: 2 * ax() - p.x, y: p.y });
  const onAxis = (p: Pt) => Math.abs(p.x - ax()) < 1e-6;
  const byId = (id: number | null) => shapes.find((s) => s.id === id) ?? null;
  const drawing = () => byId(drawingId);

  function log(msg: string): void {
    logLines.unshift(msg);
    logLines.length = Math.min(logLines.length, 6);
  }

  // ---- Geometry --------------------------------------------------------------------------------------------
  const SAME: SideMap = { in: { side: "in", mirror: false }, out: { side: "out", mirror: false } };
  const MIRRORED: SideMap = { in: { side: "in", mirror: true }, out: { side: "out", mirror: true } };
  const SWAPPED: SideMap = { in: { side: "out", mirror: true }, out: { side: "in", mirror: true } };

  /** A symmetric shape's end on the axis is one node with its reflection; the half holds the handle on its side. */
  function axisEnd(s: Shape, i: number): Side | null {
    const n = s.points.length;
    if (s.mirror !== "symmetric") return null;
    if (i === 0 && onAxis(s.points[0])) return "out";
    if (i === n - 1 && onAxis(s.points[n - 1])) return "in";
    return null;
  }

  function geometry(s: Shape): Geo {
    const pts = s.points;
    const n = pts.length;
    const node = (a: Anchor, index: number, map: SideMap, reflected = false): ONode =>
      reflected
        ? { p: reflect(a), kind: a.kind, in: reflOff(a[map.in.side]), out: reflOff(a[map.out.side]), id: s.id, index, reflected, map }
        : { p: { x: a.x, y: a.y }, kind: a.kind, in: a.in, out: a.out, id: s.id, index, reflected, map };
    let outlines: Outline[];
    if (s.mirror === "symmetric") {
      // The carver's half joined to its reversed reflection. An end on the axis is one node whose other handle is
      // its own reflected; an end off the axis is joined to its reflection by an edge.
      const nodes = pts.map((a, i) => {
        const own = axisEnd(s, i);
        if (!own) return node(a, i, SAME);
        const other = opposite(own);
        const nd = node(a, i, { ...SAME, [other]: { side: own, mirror: true } });
        nd[other] = reflOff(a[own]);
        return nd;
      });
      for (let i = n - 1; i >= 0; i--) if (!axisEnd(s, i)) nodes.push(node(pts[i], i, SWAPPED, true));
      outlines = [{ nodes, closed: true }];
    } else {
      outlines = [{ nodes: pts.map((a, i) => node(a, i, SAME)), closed: s.closed }];
      if (s.mirror === "twin") outlines.push({ nodes: pts.map((a, i) => node(a, i, MIRRORED, true)), closed: s.closed });
    }
    for (const o of outlines) resolveAuto(o);
    const edges = outlines.flatMap((o) =>
      segments(o).map(([u, v]) => ({
        a: u.p,
        c1: add(u.p, u.out ?? ZERO),
        c2: add(v.p, v.in ?? ZERO),
        b: v.p,
        id: s.id,
        insertAt: u.index === v.index ? -1 : Math.abs(u.index - v.index) === 1 ? Math.max(u.index, v.index) : n,
      })),
    );
    return { outlines, edges };
  }
  const segments = (o: Outline): [ONode, ONode][] => {
    const m = o.nodes.length;
    const out: [ONode, ONode][] = [];
    for (let k = 0; k + 1 < m; k++) out.push([o.nodes[k], o.nodes[k + 1]]);
    if (o.closed && m > 2) out.push([o.nodes[m - 1], o.nodes[0]]);
    return out;
  };
  const neighbour = (o: Outline, k: number, side: Side): ONode | null => {
    const m = o.nodes.length;
    const j = side === "out" ? k + 1 : k - 1;
    if (j >= 0 && j < m) return o.nodes[j];
    return o.closed && m > 2 ? o.nodes[(j + m) % m] : null;
  };
  /**
   * A smooth point without stored handles works them out from its neighbours: along previous → next, a third of
   * the way to each. One stored handle (an open end, or a symmetric shape's axis end) sets the line for the other.
   */
  function resolveAuto(o: Outline): void {
    o.nodes.forEach((nd, k) => {
      if (nd.kind !== "smooth" || (nd.in && nd.out)) return;
      const prev = neighbour(o, k, "in");
      const next = neighbour(o, k, "out");
      let dir: Pt | null = null;
      if (nd.out) dir = unit(nd.out);
      else if (nd.in) dir = scale(unit(nd.in), -1);
      else if (prev && next) dir = unit(sub(next.p, prev.p));
      else if (next) dir = unit(sub(next.p, nd.p));
      else if (prev) dir = unit(sub(nd.p, prev.p));
      if (!dir) return;
      if (!nd.out && next) nd.out = scale(dir, dist(nd.p, next.p) / 3);
      if (!nd.in && prev) nd.in = scale(dir, -dist(nd.p, prev.p) / 3);
    });
  }
  /** Where a source point sits in its first outline. */
  function locate(s: Shape, i: number): { o: Outline; k: number } {
    const o = geometry(s).outlines[0];
    return { o, k: o.nodes.findIndex((q) => q.index === i && !q.reflected) };
  }
  /** A point's handles as they act, automatic ones worked out, unreflected. */
  function effective(s: Shape, i: number): { in?: Pt; out?: Pt } {
    const { o, k } = locate(s, i);
    return { in: o.nodes[k].in, out: o.nodes[k].out };
  }
  /** Store a smooth point's automatic handles, so a change nearby doesn't recompute them away. */
  function freeze(s: Shape, i: number): void {
    const a = s.points[i];
    if (!a || a.kind !== "smooth" || (a.in && a.out)) return;
    const e = effective(s, i);
    const own = axisEnd(s, i);
    for (const side of own ? [own] : SIDES) setOff(a, side, e[side]);
  }

  // ---- Edits -----------------------------------------------------------------------------------------------
  const snapshot = () => JSON.stringify(shapes);
  function restore(json: string): void {
    shapes = JSON.parse(json) as Shape[];
    const d = drawing();
    if (!d || d.closed) drawingId = null;
    const sel = selection && byId(selection.id);
    if (!sel || (selection?.kind === "point" && selection.index >= sel.points.length)) selection = null;
  }
  function pushUndo(before: string): void {
    if (snapshot() === before) return;
    undoStack.push(before);
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    redoStack = [];
  }
  function change(label: string, fn: () => void): void {
    const before = snapshot();
    fn();
    pushUndo(before);
    log(label);
    renderAll();
  }
  function undo(how: string): void {
    const prev = undoStack.pop();
    if (prev === undefined) return void log(`${how} → nothing to undo`);
    redoStack.push(snapshot());
    restore(prev);
    log(`${how} → undo`);
    renderAll();
  }
  function redo(how: string): void {
    const next = redoStack.pop();
    if (next === undefined) return void log(`${how} → nothing to redo`);
    undoStack.push(snapshot());
    restore(next);
    log(`${how} → redo`);
    renderAll();
  }

  /** Clamp to the photo; for a mirrored shape, snap onto the axis within the hit distance and keep to its side. */
  function constrain(s: Shape | null, mirrored: boolean, raw: Pt, skip: number, wasSnapped: boolean) {
    let x = clamp(raw.x, 0, W);
    const y = clamp(raw.y, 0, H);
    let snapped = false;
    if (mirrored) {
      if (Math.abs(x - ax()) * view.s < tuning.hit * (wasSnapped ? 1.5 : 1)) x = ax();
      let side = 0;
      if (s) for (const [i, p] of s.points.entries()) if (i !== skip && !onAxis(p)) { side = Math.sign(p.x - ax()); break; }
      if (side > 0) x = Math.max(x, ax());
      else if (side < 0) x = Math.min(x, ax());
      snapped = x === ax();
    }
    return { p: { x, y }, snapped };
  }

  function placePoint(p: Pt, snapped: boolean, how: string): void {
    change(`${how} → place point`, () => {
      let s = drawing();
      if (!s) {
        s = { id: nextId++, points: [], closed: false, mirror: symmetry ? "twin" : "none" };
        shapes.push(s);
        drawingId = s.id;
        logLines.unshift(`new shape #${s.id}${symmetry ? " (mirrored)" : ""}`);
      }
      s.points.push({ ...p, kind: "corner" });
      const offAxis = s.points.some((q) => !onAxis(q));
      if (s.mirror !== "none" && snapped && s.points.length >= 3 && onAxis(s.points[0]) && offAxis) {
        s.mirror = "symmetric";
        s.closed = true;
        drawingId = null;
        logLines.unshift(`landed on axis → closed #${s.id} as symmetric`);
      }
    });
  }
  function closeShape(how: string): void {
    const s = drawing();
    if (!s || s.points.length < 3) return void (log(`${how} → can't close (needs 3 points)`), renderAll());
    // A mirrored shape whose closed outline runs along the axis (two points in a row on it, the closing edge
    // included) is half of one symmetric shape, wherever it was started: start the half just after that edge,
    // so it runs axis to axis, and the edge drops out when the reflection joins on.
    const n = s.points.length;
    const along = s.mirror === "twin" ? s.points.findIndex((p, i) => onAxis(p) && onAxis(s.points[(i + 1) % n])) : -1;
    if (along >= 0) {
      return change(`${how} → close #${s.id} with an edge on the axis → symmetric`, () => {
        s.points = [...s.points.slice(along + 1), ...s.points.slice(0, along + 1)];
        s.mirror = "symmetric";
        s.closed = true;
        drawingId = null;
      });
    }
    change(`${how} → close #${s.id}${s.mirror === "twin" ? " as twin" : ""}`, () => {
      s.closed = true;
      drawingId = null;
    });
  }
  function endShape(how: string): void {
    if (drawingId === null) return;
    log(`${how} → end #${drawingId} open`);
    drawingId = null;
    renderAll();
  }
  function carryOn(d: Dot, how: string): void {
    const s = byId(d.id)!;
    if (d.index === 0 && s.points.length > 1) {
      // Carry on from the first end: the same shape, run the other way, so each point's handles swap sides.
      s.points.reverse();
      s.points = s.points.map(({ in: i, out: o, ...rest }) => ({ ...rest, ...(o && { in: o }), ...(i && { out: i }) }));
    }
    drawingId = s.id;
    selection = null;
    log(`${how} → carry on #${s.id}`);
    renderAll();
  }
  /**
   * Split source segment `k` (ending at point k, or the closing one when k = n) at its middle. With ⚙ split
   * "smooth", exactly: the new point is smooth and the outline doesn't move. With "corner", the new point is a
   * corner with no handles at the curve's middle, and the neighbours keep their exact-split handles, so each half
   * bends at its outer end only.
   */
  function splitAt(s: Shape, k: number): number {
    const n = s.points.length;
    const [i, j] = [k - 1, k % n];
    const [A, B] = [s.points[i], s.points[j]];
    const [ea, eb] = [effective(s, i), effective(s, j)];
    const [a, b] = [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
    if (!ea.out && !eb.in) {
      s.points.splice(k, 0, { ...mid(a, b), kind: "corner" });
      return k;
    }
    // de Casteljau at t = 0.5: the outline doesn't move.
    const [c1, c2] = [add(a, ea.out ?? ZERO), add(b, eb.in ?? ZERO)];
    const [p01, p12, p23] = [mid(a, c1), mid(c1, c2), mid(c2, b)];
    const [p012, p123] = [mid(p01, p12), mid(p12, p23)];
    const m = mid(p012, p123);
    freeze(s, i);
    freeze(s, j);
    setOff(A, "out", sub(p01, a));
    setOff(B, "in", sub(p23, b));
    s.points.splice(k, 0, tuning.split === "smooth" ? { ...m, kind: "smooth", in: sub(p012, m), out: sub(p123, m) } : { ...m, kind: "corner" });
    return k;
  }
  /** Smooth ⇄ Corner, by the rules of "Curves in v1". */
  function toggleKind(s: Shape, i: number): Kind {
    const a = s.points[i];
    const e = effective(s, i);
    const own = axisEnd(s, i);
    if (a.kind === "smooth") {
      // Corner keeps the handles where they are, now independent.
      a.kind = "corner";
      for (const side of own ? [own] : SIDES) setOff(a, side, e[side]);
      return "corner";
    }
    a.kind = "smooth";
    if (own) {
      // A smooth axis point holds its handle at right angles to the axis.
      const h = a[own];
      setOff(a, own, h && { x: h.x, y: 0 });
    } else if (a.in && a.out) {
      // Average the two directions, keeping each length.
      const d = unit(sub(unit(a.out), unit(a.in)));
      a.out = scale(d, len(a.out));
      a.in = scale(d, -len(a.in));
    } // One handle or none: the rest is automatic.
    return "smooth";
  }
  /** "+ Handles": give a corner the handles it lacks, along its edges, a third of the way to each neighbour. */
  function addHandles(s: Shape, i: number): void {
    const { o, k } = locate(s, i);
    const nd = o.nodes[k];
    const own = axisEnd(s, i);
    for (const side of own ? [own] : SIDES) {
      const q = neighbour(o, k, side);
      if (nd[side] || !q) continue;
      const toward = add(q.p, q[opposite(side)] ?? ZERO);
      s.points[i][side] = scale(unit(sub(toward, nd.p)), dist(nd.p, q.p) / 3);
    }
  }
  const canAddHandles = (s: Shape, i: number) => {
    if (s.points[i].kind !== "corner") return false;
    const { o, k } = locate(s, i);
    const own = axisEnd(s, i);
    return (own ? [own] : SIDES).some((side) => !o.nodes[k][side] && neighbour(o, k, side));
  };
  /**
   * Set a handle by dragging it. A smooth point turns its other handle to stay in line, keeping its length; a
   * smooth axis point keeps its handle at right angles to the axis. Dragged onto its point, the handle goes.
   */
  function setHandle(s: Shape, i: number, side: Side, o: Pt): string {
    const a = s.points[i];
    const own = axisEnd(s, i);
    if (own) side = own;
    if (own && a.kind === "smooth") o = { x: o.x, y: 0 };
    const had = !!effective(s, i)[side];
    if (len(o) * view.s < RETRACT) {
      const e = effective(s, i);
      delete a[side];
      if (a.kind !== "smooth") return "handle retracted → that side straight";
      a.kind = "corner";
      if (!own) setOff(a, opposite(side), e[opposite(side)]);
      return "handle retracted → that side straight, point now a corner";
    }
    if (a.kind === "smooth" && !own) {
      const other = effective(s, i)[opposite(side)];
      if (other) a[opposite(side)] = scale(unit(o), -len(other));
    }
    a[side] = o;
    return had ? "handle moved" : "handle pulled out of a corner";
  }
  function deleteSelection(how: string): void {
    const sel = selection;
    if (!sel) return;
    const s = byId(sel.id)!;
    change(`${how} → delete ${sel.kind}`, () => {
      if (sel.kind === "point") {
        const n = s.points.length;
        for (const j of [sel.index - 1, sel.index + 1]) if (s.closed || (j >= 0 && j < n)) freeze(s, (j + n) % n);
        s.points.splice(sel.index, 1);
        const distinct = s.mirror === "symmetric" ? geometry(s).outlines[0].nodes.length : s.points.length;
        if (s.points.length === 0 || (s.closed && distinct < 3)) shapes = shapes.filter((q) => q !== s);
      } else shapes = shapes.filter((q) => q !== s);
      selection = null;
      if (!byId(drawingId)) drawingId = null;
    });
  }
  function clearAll(how: string): void {
    if (shapes.length === 0) return;
    change(`${how} → clear all`, () => {
      shapes = [];
      drawingId = null;
      selection = null;
    });
  }
  /** The demo shapes, fitted to whatever is being traced over. */
  function loadDemo(): void {
    const k = Math.min(W / 1200, H / 1500);
    change("Demo → load curved shapes", () => {
      for (const d of demoShapes()) {
        const pts = d.points.map((a) => ({
          ...a,
          x: ax() + (a.x - 600) * k,
          y: a.y * k,
          ...(a.in && { in: scale(a.in, k) }),
          ...(a.out && { out: scale(a.out, k) }),
        }));
        shapes.push({ ...d, id: nextId++, points: pts });
      }
      drawingId = null;
      selection = null;
    });
  }

  // ---- Hit testing -----------------------------------------------------------------------------------------
  /** The handles (and stubs) showing now, by the Show and Pull settings. None while a shape is being drawn. */
  function knobs(): Knob[] {
    if (drawingId !== null || !selection) return [];
    const s = byId(selection.id);
    if (!s) return [];
    const selIdx = selection.kind === "point" ? selection.index : -1;
    const list: Knob[] = [];
    const push = (nd: ONode, side: Side, stubTip?: Pt) => {
      const o = nd[side];
      if (!stubTip && (!o || len(o) < 1e-6)) return;
      const m = nd.map[side];
      const own = selIdx < 0 || nd.index === selIdx;
      list.push({ base: nd.p, tip: stubTip ?? add(nd.p, o!), id: s.id, index: nd.index, side: m.side, mirror: m.mirror, stub: !!stubTip, own });
    };
    for (const o of geometry(s).outlines)
      o.nodes.forEach((nd, k) => {
        const mine = nd.index === selIdx;
        if (tuning.show === "shape" || mine) for (const side of SIDES) push(nd, side);
        else if (tuning.show === "neighbours" && selIdx >= 0)
          for (const side of SIDES) if (neighbour(o, k, side)?.index === selIdx) push(nd, side);
        if (mine && tuning.pull === "stub" && nd.kind === "corner")
          for (const side of SIDES) {
            const q = neighbour(o, k, side);
            if (nd[side] || !q) continue;
            const toward = add(q.p, q[opposite(side)] ?? ZERO);
            push(nd, side, add(nd.p, scale(unit(sub(toward, nd.p)), STUB / view.s)));
          }
      });
    return list;
  }

  function hitTest(p: Pt, editing: boolean): Hit {
    const r = tuning.hit;
    // The shape being drawn wins ties, then later shapes (drawn on top).
    const order = [...shapes].reverse().sort((a, b) => Number(b.id === drawingId) - Number(a.id === drawingId));
    let dot: ONode | null = null;
    let dotD = r;
    for (const s of order)
      for (const o of geometry(s).outlines)
        for (const nd of o.nodes) {
          const d = dist(toScreen(nd.p), p);
          if (d < dotD) [dot, dotD] = [nd, d];
        }
    let knob: Knob | null = null;
    let knobD = r;
    if (editing)
      for (const k of knobs()) {
        const d = dist(toScreen(k.tip), p);
        if (d < knobD) [knob, knobD] = [k, d];
      }
    if (dot || knob) {
      const useKnob =
        tuning.priority === "handles" ? !!knob : tuning.priority === "points" ? !dot : !!knob && (!dot || knobD <= dotD);
      return useKnob ? { kind: "knob", k: knob! } : { kind: "point", d: dot! };
    }
    const sel = selection && byId(selection.id);
    if (editing && sel) for (const e of visibleMarkers(sel)) if (dist(toScreen(bez(e, 0.5)), p) < r) return { kind: "marker", e };
    const d = toDesign(p);
    for (const s of order)
      for (const o of geometry(s).outlines) {
        const nearEdge = segments(o).some((sg) => {
          const pts = flat(segEdge(sg), toScreen);
          return pts.some((q, i) => i > 0 && segDist(p, pts[i - 1], q) < r * 0.6);
        });
        // Which copy was touched, so dragging a twin's reflection moves it the way the finger goes.
        if (nearEdge || (o.closed && inside(d, outlinePoly(o)))) return { kind: "shape", id: s.id, reflected: !!o.nodes[0]?.reflected };
      }
    return { kind: "empty" };
  }
  const segEdge = ([u, v]: [ONode, ONode]): Edge => ({ a: u.p, c1: add(u.p, u.out ?? ZERO), c2: add(v.p, v.in ?? ZERO), b: v.p, id: 0, insertAt: 0 });
  const outlinePoly = (o: Outline): Pt[] => segments(o).flatMap((sg) => flat(segEdge(sg)).slice(1));
  /** Insert markers: hidden on edges shorter than about 48 px along the curve on screen. */
  const visibleMarkers = (s: Shape) =>
    geometry(s).edges.filter((e) => {
      if (e.insertAt < 0) return false;
      const pts = flat(e, toScreen);
      const length = pts.reduce((sum, q, i) => (i ? sum + dist(pts[i - 1], q) : 0), 0);
      return length >= Math.max(48, 2.2 * tuning.hit);
    });

  // ---- Actions ---------------------------------------------------------------------------------------------
  function placeAction(g: OneGesture): Action {
    let snapped = false;
    let pt: Pt = toDesign(g.last);
    const update = (screen: Pt) => {
      const s = drawing();
      const mirrored = s ? s.mirror !== "none" : symmetry;
      const r = constrain(s, mirrored, toDesign(screen), -1, snapped);
      [pt, snapped] = [r.p, r.snapped];
      preview = pt;
      axisHot = mirrored && snapped;
    };
    update(g.last);
    return {
      loupe: true,
      focus: () => pt,
      move: update,
      end(p) {
        update(p);
        preview = null;
        axisHot = false;
        placePoint(pt, snapped, "hold + lift");
      },
      cancel() {
        preview = null;
        axisHot = false;
      },
    };
  }
  function dragPointAction(g: OneGesture, h: Dot, before = snapshot(), how = "drag point"): Action {
    const s0 = byId(h.id)!;
    let snapped = onAxis(s0.points[h.index]);
    const grab = sub(toScreen(h.p), g.start);
    selection = { kind: "point", id: h.id, index: h.index };
    const shown = () => {
      const p = byId(h.id)!.points[h.index];
      return h.reflected ? reflect(p) : p;
    };
    return {
      loupe: true,
      focus: shown,
      move(screen) {
        const s = byId(h.id)!;
        let raw = toDesign(add(screen, grab));
        if (h.reflected) raw = reflect(raw);
        const r = constrain(s, s.mirror !== "none", raw, h.index, snapped);
        Object.assign(s.points[h.index], r.p);
        snapped = r.snapped;
        axisHot = s.mirror !== "none" && snapped;
      },
      end() {
        axisHot = false;
        pushUndo(before);
        log(how);
      },
      cancel() {
        axisHot = false;
        restore(before);
      },
    };
  }
  function insertDragAction(g: OneGesture, e: Edge): Action {
    const before = snapshot();
    const s = byId(e.id)!;
    const at = bez(e, 0.5);
    const index = splitAt(s, e.insertAt);
    const p = s.points[index];
    // The marker may have been on the reflection: drag whichever copy of the new point is under the finger.
    const reflected = !onAxis(p) && dist(at, reflect(p)) < dist(at, p);
    const h: Dot = { p: reflected ? reflect(p) : { x: p.x, y: p.y }, id: e.id, index, reflected };
    return dragPointAction({ ...g, start: toScreen(h.p) }, h, before, "drag insert marker → insert + move");
  }
  function dragKnobAction(g: OneGesture, k: Knob): Action {
    const before = snapshot();
    const grab = sub(toScreen(k.tip), g.start);
    let tip = k.tip;
    let what = "nothing";
    if (selection?.kind !== "shape") selection = { kind: "point", id: k.id, index: k.index };
    return {
      loupe: tuning.hloupe,
      focus: () => tip,
      move(screen) {
        // Each move starts again from before the drag, so a handle dragged in and out again isn't stuck retracted.
        shapes = JSON.parse(before) as Shape[];
        const s = byId(k.id)!;
        const raw = toDesign(add(screen, grab));
        const o = sub({ x: clamp(raw.x, 0, W), y: clamp(raw.y, 0, H) }, k.base);
        what = setHandle(s, k.index, k.side, k.mirror ? reflOff(o)! : o);
        const h = s.points[k.index][axisEnd(s, k.index) ?? k.side];
        tip = h ? add(k.base, k.mirror ? reflOff(h)! : h) : k.base;
      },
      end() {
        pushUndo(before);
        log(`${k.stub ? "drag stub" : `drag handle${k.mirror ? " (on reflection)" : ""}`} → ${what}`);
      },
      cancel: () => restore(before),
    };
  }
  function dragShapeAction(g: OneGesture, id: number, reflected: boolean): Action {
    const before = snapshot();
    const orig = byId(id)!.points.map((p) => ({ ...p }));
    const start = toDesign(g.start);
    return {
      loupe: false,
      focus: () => null,
      move(screen) {
        const s = byId(id)!;
        const d = toDesign(screen);
        // The points are the carver's side; dragging the reflection moves them the other way.
        let dx = (d.x - start.x) * (reflected ? -1 : 1);
        let dy = d.y - start.y;
        const xs = orig.map((p) => p.x);
        const ys = orig.map((p) => p.y);
        dx = clamp(dx, -Math.min(...xs), W - Math.max(...xs));
        dy = clamp(dy, -Math.min(...ys), H - Math.max(...ys));
        if (s.mirror === "symmetric") dx = 0;
        if (s.mirror === "twin") {
          const side = Math.sign(orig.find((p) => !onAxis(p))!.x - ax());
          if (side > 0) dx = Math.max(dx, ax() - Math.min(...xs));
          else dx = Math.min(dx, ax() - Math.max(...xs));
        }
        s.points = orig.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      },
      end() {
        pushUndo(before);
        log("drag selected shape → move shape");
      },
      cancel: () => restore(before),
    };
  }
  function panAction(g: OneGesture, how = "drag empty → pan"): Action {
    let last = g.start;
    return {
      loupe: false,
      focus: () => null,
      move(p) {
        view.tx += p.x - last.x;
        view.ty += p.y - last.y;
        last = p;
        userMoved = true;
      },
      end: () => log(how),
      cancel() {},
    };
  }

  // ---- Policy: what a touch does, by what's under it (#14's modeless model) ---------------------------------
  /** A tap on a point of the shape being drawn. */
  function drawPointTap(d: Dot, how: string, at: Pt): void {
    const s = byId(d.id)!;
    if (d.index === s.points.length - 1) return endShape(`${how} on last point`);
    if (d.index === 0) return closeShape(`${how} on first point`);
    const r = constrain(s, s.mirror !== "none", toDesign(at), -1, false);
    placePoint(r.p, r.snapped, `${how} on a middle point`);
  }
  function tap(hit: Hit, p: Pt): void {
    const s = drawing();
    if (s) {
      if (hit.kind === "point" && hit.d.id === s.id) return drawPointTap(hit.d, "tap", p);
      if (hit.kind === "point") {
        drawingId = null;
        selection = { kind: "point", id: hit.d.id, index: hit.d.index };
        log("tap another shape's point while drawing → end drawing + select");
        return renderAll();
      }
      const r = constrain(s, s.mirror !== "none", toDesign(p), -1, false);
      return placePoint(r.p, r.snapped, "tap");
    }
    if (hit.kind === "knob") {
      log(`tap ${hit.k.stub ? "stub" : "handle"} → nothing`);
      return renderAll();
    }
    if (hit.kind === "empty") {
      if (selection) {
        selection = null;
        log("tap empty → deselect (no point placed)");
        return renderAll();
      }
      const r = constrain(null, symmetry, toDesign(p), -1, false);
      return placePoint(r.p, r.snapped, "tap empty");
    }
    if (hit.kind === "marker") {
      const e = hit.e;
      return change("tap insert marker → insert", () => {
        const index = splitAt(byId(e.id)!, e.insertAt);
        selection = { kind: "point", id: e.id, index };
      });
    }
    if (hit.kind === "point") {
      selection = { kind: "point", id: hit.d.id, index: hit.d.index };
      log(`tap point → select point${hit.d.reflected ? " (on reflection)" : ""}`);
    } else {
      selection = { kind: "shape", id: hit.id };
      log("tap shape → select shape");
    }
    renderAll();
  }
  /** A second tap on the same point: take back what the first tap did, and toggle the point's kind instead. */
  function doubleTap(t: TapRecord): void {
    const d = t.dot!;
    shapes = JSON.parse(t.shapes) as Shape[];
    drawingId = t.drawingId === d.id ? d.id : null;
    undoStack.length = t.undo;
    redoStack = t.redo;
    selection = drawingId === null ? { kind: "point", id: d.id, index: d.index } : null;
    const s = byId(d.id)!;
    change(`double-tap point → first tap taken back, ${s.points[d.index].kind === "smooth" ? "Corner" : "Smooth"}`, () =>
      toggleKind(s, d.index),
    );
  }
  function hold(g: OneGesture): Action | null {
    if (g.hit.kind === "point") return dragPointAction(g, g.hit.d, undefined, "hold + drag point → move");
    if (g.hit.kind === "knob") return dragKnobAction(g, g.hit.k);
    if (g.hit.kind === "marker") return insertDragAction(g, g.hit.e);
    if (drawingId !== null || !selection) return placeAction(g);
    return null;
  }
  function drag(g: OneGesture): Action {
    const hit = g.hit;
    if (hit.kind === "point") return dragPointAction(g, hit.d);
    if (hit.kind === "knob") return dragKnobAction(g, hit.k);
    if (hit.kind === "marker") return insertDragAction(g, hit.e);
    if (hit.kind === "shape" && selection?.kind === "shape" && selection.id === hit.id) return dragShapeAction(g, hit.id, hit.reflected);
    return panAction(g);
  }

  // ---- Pointer handling ------------------------------------------------------------------------------------
  const pointers = new Map<number, { p: Pt; down: Pt }>();
  let gesture: OneGesture | MultiGesture | null = null;
  const local = (e: PointerEvent): Pt => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function cancelOne(g: OneGesture): void {
    clearTimeout(g.timer);
    g.active?.cancel();
    g.active = null;
    preview = null;
  }

  svg.addEventListener("pointerdown", (e) => {
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // A scripted pointer (testing) can't be captured.
    }
    const p = local(e);
    pointers.set(e.pointerId, { p, down: p });
    if (pointers.size === 1 && !gesture) {
      const g: OneGesture = { type: "one", id: e.pointerId, start: p, last: p, hit: hitTest(p, drawingId === null), active: null, t0: performance.now() };
      g.timer = window.setTimeout(() => {
        if (gesture !== g || g.active) return;
        g.active = hold(g);
        if (g.active) g.active.move(g.last);
        render();
      }, tuning.hold);
      gesture = g;
      render();
      return;
    }
    lastTap = null;
    if (gesture?.type === "one") {
      // A two-finger tap starts with one finger: time it from that one, and not if it was already dragging.
      const one = gesture;
      const had = one.active !== null;
      cancelOne(one);
      log(`second finger → ${had ? "cancel the drag" : "cancel the tap"}`);
      gesture = { type: "multi", t0: one.t0, max: 0, moved: had, prev: null };
    }
    if (gesture?.type !== "multi") gesture = { type: "multi", t0: performance.now(), max: 0, moved: false, prev: null };
    gesture.max = Math.max(gesture.max, pointers.size);
    gesture.prev = null;
    renderAll();
  });

  svg.addEventListener("pointermove", (e) => {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const p = local(e);
    rec.p = p;
    if (gesture?.type === "one" && gesture.id === e.pointerId) {
      gesture.last = p;
      if (!gesture.active) {
        if (dist(p, gesture.start) <= SLOP) return;
        clearTimeout(gesture.timer);
        gesture.active = drag(gesture);
      }
      gesture.active.move(p);
      render();
    } else if (gesture?.type === "multi") {
      if (dist(p, rec.down) > SLOP) gesture.moved = true;
      const two = [...pointers.values()].slice(0, 2).map((r) => r.p);
      if (two.length < 2) return void (gesture.prev = null);
      const c = mid(two[0], two[1]);
      const d = Math.max(1, dist(two[0], two[1]));
      if (gesture.prev) {
        const k = clamp(view.s * (d / gesture.prev.d), fitScale() * 0.5, fitScale() * 25) / view.s;
        view.tx = c.x - (gesture.prev.c.x - view.tx) * k;
        view.ty = c.y - (gesture.prev.c.y - view.ty) * k;
        view.s *= k;
        userMoved = true;
      }
      gesture.prev = { c, d };
      render();
    }
  });

  const pointerEnd = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (gesture?.type === "one" && gesture.id === e.pointerId) {
      const g = gesture;
      gesture = null;
      clearTimeout(g.timer);
      if (e.type === "pointercancel") cancelOne(g);
      else if (g.active) {
        g.active.end(p);
        lastTap = null;
      } else {
        const now = performance.now();
        const prev = lastTap;
        if (prev?.dot && tuning.dbl > 0 && now - prev.t < tuning.dbl && dist(g.start, prev.at) < tuning.hit) {
          lastTap = null;
          doubleTap(prev);
        } else {
          lastTap = {
            t: now,
            at: g.start,
            dot: g.hit.kind === "point" ? g.hit.d : null,
            shapes: snapshot(),
            drawingId,
            undo: undoStack.length,
            redo: [...redoStack],
          };
          tap(g.hit, g.start);
        }
      }
      preview = null;
      renderAll();
    } else if (gesture?.type === "multi") {
      gesture.prev = null;
      if (pointers.size > 0) return;
      const g = gesture;
      gesture = null;
      if (!g.moved && performance.now() - g.t0 < TAP_MS) {
        if (g.max === 2) return undo("two-finger tap");
        if (g.max >= 3) return redo("three-finger tap");
      }
      if (g.moved) log("pinch / two-finger drag → zoom + pan");
      renderAll();
    }
  };
  svg.addEventListener("pointerup", pointerEnd);
  svg.addEventListener("pointercancel", pointerEnd);
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const c = { x: e.clientX - r.left, y: e.clientY - r.top };
      const k = clamp(view.s * Math.exp(-e.deltaY * 0.002), fitScale() * 0.5, fitScale() * 25) / view.s;
      view.tx = c.x - (c.x - view.tx) * k;
      view.ty = c.y - (c.y - view.ty) * k;
      view.s *= k;
      userMoved = true;
      render();
    },
    { passive: false },
  );

  // ---- View ------------------------------------------------------------------------------------------------
  const fitScale = () => {
    const { w, h } = size();
    return Math.max(1e-3, Math.min(w / W, h / H) * 0.94);
  };
  function fit(): void {
    const { w, h } = size();
    if (w === 0 || h === 0) return;
    view.s = fitScale();
    view.tx = (w - W * view.s) / 2;
    view.ty = (h - H * view.s) / 2;
  }
  new ResizeObserver(() => {
    if (!userMoved) fit();
    renderAll();
  }).observe(svg);

  /** What the shapes are traced over: the sample drawing, a blank page, or a photo loaded in the Design step. */
  let base: "sample" | "blank" | "photo" = params.get("base") === "blank" ? "blank" : "sample";
  /** Swapping between the sample and the blank page (same size) keeps the shapes; a new photo clears them. */
  function setPhoto(src: CanvasImageSource & { width: number; height: number }, keep = false): void {
    const k = Math.min(1, MAX_PHOTO / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    [W, H] = [c.width, c.height];
    photoImg.setAttribute("href", c.toDataURL("image/jpeg", 0.9));
    photoImg.setAttribute("width", String(W));
    photoImg.setAttribute("height", String(H));
    if (keep) {
      log(`now tracing over: ${base}`);
      return renderAll();
    }
    shapes = [];
    undoStack = [];
    redoStack = [];
    drawingId = null;
    selection = null;
    userMoved = false;
    fit();
    log(`photo ${W}×${H} loaded`);
    renderAll();
  }
  window.addEventListener("prototype-photo", (e) => {
    base = "photo";
    setParam("base", null);
    setPhoto((e as CustomEvent<ImageBitmap>).detail);
  });
  /** The sample drawing's ink: the demo shapes' outlines, at the sample's size. */
  function demoInk(): string[] {
    [W, H] = [1200, 1500];
    return demoShapes().flatMap((s) => geometry(s).outlines.map((o) => pathOf(o, (p) => p)));
  }

  // ---- Rendering -------------------------------------------------------------------------------------------
  const xy = (p: Pt) => `${f(p.x)} ${f(p.y)}`;
  /** An outline as SVG path data in some mapping, from segment `from` on. */
  function pathOf(o: Outline, map: (p: Pt) => Pt, from = 0): string {
    const segs = segments(o).slice(from);
    if (!o.nodes.length) return "";
    let d = `M${xy(map(segs.length ? segs[0][0].p : o.nodes[0].p))}`;
    for (const [u, v] of segs)
      d +=
        u.out || v.in
          ? `C${xy(map(add(u.p, u.out ?? ZERO)))} ${xy(map(add(v.p, v.in ?? ZERO)))} ${xy(map(v.p))}`
          : `L${xy(map(v.p))}`;
    return d + (o.closed && from === 0 ? "Z" : "");
  }
  const axisShown = () => {
    const sel = selection && byId(selection.id);
    const d = drawing();
    return symmetry || (!!sel && sel.mirror !== "none") || (!!d && d.mirror !== "none");
  };

  /** The overlay in some screen mapping: the main view (`dot` = 1) or the loupe. */
  function overlay(map: (p: Pt) => Pt, dot: number, hits: boolean): string {
    const out: string[] = [];
    if (axisShown()) {
      const [a, b] = [map({ x: ax(), y: 0 }), map({ x: ax(), y: H })];
      out.push(`<line class="ht-axis${axisHot ? " hot" : ""}" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"/>`);
    }
    const geos = shapes.map((s) => ({ s, g: geometry(s) }));
    const fill = geos.flatMap(({ g }) => g.outlines.filter((o) => o.closed && o.nodes.length > 2).map((o) => pathOf(o, map)));
    if (fill.length) out.push(`<path class="ht-fill" d="${fill.join("")}"/>`);
    const selId = selection?.id ?? null;
    for (const { s, g } of geos) {
      const cls = `ht-line${s.id === selId ? " sel" : ""}${s.id === drawingId ? " drawing" : ""}${s.closed ? "" : " open"}`;
      for (const o of g.outlines) out.push(`<path class="${cls}" d="${pathOf(o, map)}"/>`);
    }
    // Rubber band: the last edge and the next one as they'd be with a point where the finger is.
    const d = drawing();
    if (preview) {
      if (d?.points.length) {
        const temp: Shape = { ...d, points: [...d.points, { ...preview, kind: "corner" }] };
        for (const o of geometry(temp).outlines)
          out.push(`<path class="ht-band" d="${pathOf(o, map, Math.max(0, d.points.length - 2))}"/>`);
      }
      const mirroredNow = d ? d.mirror !== "none" : symmetry;
      for (const p of [preview, ...(mirroredNow ? [reflect(preview)] : [])])
        out.push(`<circle class="ht-ghost" cx="${f(map(p).x)}" cy="${f(map(p).y)}" r="${6 * dot}"/>`);
    }
    // Insert markers on the selected shape, at each curve's middle.
    const sel = selection && byId(selection.id);
    if (sel && drawingId === null)
      for (const e of visibleMarkers(sel)) {
        const m = map(bez(e, 0.5));
        out.push(`<rect class="ht-marker" x="${f(m.x - 4 * dot)}" y="${f(m.y - 4 * dot)}" width="${8 * dot}" height="${8 * dot}" transform="rotate(45 ${f(m.x)} ${f(m.y)})"/>`);
        if (hits) out.push(`<circle class="ht-hitarea" cx="${f(m.x)}" cy="${f(m.y)}" r="${tuning.hit}"/>`);
      }
    // Points: corners as squares, smooth points as circles.
    for (const { s, g } of geos)
      for (const o of g.outlines)
        for (const nd of o.nodes) {
          const m = map(nd.p);
          const end = !s.closed && (nd.index === 0 || nd.index === s.points.length - 1);
          const isSel = selection?.kind === "point" && selection.id === s.id && selection.index === nd.index;
          const closable = s.id === drawingId && nd.index === 0 && s.points.length >= 3;
          let cls = "ht-pt";
          if (isSel) cls += " sel";
          if (end) cls += " end";
          if (closable) cls += " closable";
          const r = (s.id === drawingId || s.id === selId ? 5.5 : 4) * dot;
          if (closable) out.push(`<circle class="ht-close-ring" cx="${f(m.x)}" cy="${f(m.y)}" r="${11 * dot}"/>`);
          out.push(
            nd.kind === "smooth"
              ? `<circle class="${cls}" cx="${f(m.x)}" cy="${f(m.y)}" r="${r}"/>`
              : `<rect class="${cls}" x="${f(m.x - r * 0.9)}" y="${f(m.y - r * 0.9)}" width="${f(r * 1.8)}" height="${f(r * 1.8)}"/>`,
          );
          if (hits) out.push(`<circle class="ht-hitarea" cx="${f(m.x)}" cy="${f(m.y)}" r="${tuning.hit}"/>`);
        }
    // Handles, on top.
    // Neighbours' handles faint and hollow, under the selected point's own.
    for (const k of knobs().sort((a, b) => Number(a.own) - Number(b.own))) {
      const [a, b] = [map(k.base), map(k.tip)];
      const nb = k.own ? "" : " nb";
      out.push(`<line class="ht-hline${k.stub ? " stub" : ""}${nb}" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"/>`);
      out.push(`<circle class="${k.stub ? "ht-stub" : "ht-knob"}${nb}" cx="${f(b.x)}" cy="${f(b.y)}" r="${(k.stub ? 5.5 : k.own ? 5 : 3.5) * dot}"/>`);
      if (hits) out.push(`<circle class="ht-hitarea knob" cx="${f(b.x)}" cy="${f(b.y)}" r="${tuning.hit}"/>`);
    }
    return out.join("");
  }

  function render(): void {
    if (!userMoved) fit();
    photoG.setAttribute("transform", `matrix(${view.s} 0 0 ${view.s} ${view.tx} ${view.ty})`);
    overG.innerHTML = overlay(toScreen, 1, tuning.showHits);
    const g = gesture?.type === "one" ? gesture : null;
    const focus = g?.active?.loupe ? g.active.focus() : null;
    loupeEl.hidden = !focus;
    if (g && focus) {
      const L = tuning.loupe;
      const m = view.s * tuning.zoom;
      const lmap = (p: Pt): Pt => ({ x: (p.x - focus.x) * m + L / 2, y: (p.y - focus.y) * m + L / 2 });
      loupeEl.style.width = loupeEl.style.height = `${L}px`;
      loupeSvg.setAttribute("viewBox", `0 0 ${L} ${L}`);
      lPhotoG.setAttribute("transform", `matrix(${m} 0 0 ${m} ${L / 2 - focus.x * m} ${L / 2 - focus.y * m})`);
      lOverG.innerHTML = overlay(lmap, 0.8, false);
      // Above the finger; beside it when there's no room above.
      const { w } = size();
      let left = g.last.x - L / 2;
      let top = g.last.y - L - 56;
      if (top < 4) {
        top = Math.max(4, g.last.y - L / 2);
        left = g.last.x + 56 + L < w ? g.last.x + 56 : g.last.x - 56 - L;
      }
      loupeEl.style.left = `${clamp(left, 4, w - L - 4)}px`;
      loupeEl.style.top = `${top}px`;
    }
    renderUi();
    renderState();
  }
  function renderAll(): void {
    render();
  }

  let uiKey = "";
  function renderUi(): void {
    // The prototype's floating bits show only while the Hand-trace view does.
    const visible = root.getClientRects().length > 0;
    bar.hidden = stateEl.hidden = !visible;
    htRoot.classList.toggle("ht-full", full);
    document.documentElement.classList.toggle("ht-noscroll", full && visible);
    const d = drawing();
    const n = d?.points.length ?? 0;
    const can = { undo: undoStack.length > 0, redo: redoStack.length > 0, clear: shapes.length > 0 };
    const btn = (act: string, label: string, enabled = true, extra = "") =>
      `<button type="button" data-act="${act}" class="${extra}" ${enabled ? "" : "disabled"}>${label}</button>`;
    let pill: string;
    if (d) pill = `<span class="ht-pill-text">Drawing · ${n} pt${n === 1 ? "" : "s"}</span>${btn("close", "Close", n >= 3)}${btn("end", "End")}`;
    else if (selection?.kind === "point") {
      const s = byId(selection.id)!;
      const i = selection.index;
      const end = !s.closed && (i === 0 || i === s.points.length - 1);
      const kind = s.points[i].kind;
      pill =
        btn("delete", "Delete") +
        btn("kind", kind === "smooth" ? "Corner" : "Smooth") +
        (tuning.pull === "pill" && canAddHandles(s, i) ? btn("handles", "+ Handles") : "") +
        (end ? btn("carry", "Carry on") : "") +
        btn("deselect", "✓");
    } else if (selection?.kind === "shape") pill = btn("delete", "Delete shape") + btn("deselect", "✓");
    else pill = `<span class="ht-pill-text">Tap to place · hold for loupe · double-tap a point to curve it</span>`;
    const html = `<div class="ht-b-tl">${btn("undo", "↶", can.undo, "icon")}${btn("redo", "↷", can.redo, "icon")}</div>
      <div class="ht-b-tr">${btn("sym", "⇋ Symmetry", true, symmetry ? "on" : "")}${btn("clear", "Clear", can.clear)}</div>
      <div class="ht-pill">${pill}</div>`;
    if (html !== uiKey) {
      uiKey = html;
      uiEl.innerHTML = html;
    }
    const open = shapes.filter((s) => !s.closed).length;
    noteEl.hidden = open === 0;
    noteEl.textContent = `${open} shape${open === 1 ? " isn't" : "s aren't"} closed and won't be carved`;

    bar.innerHTML = `<button type="button" data-bar="prev">‹</button><span class="ht-bar-name">${variant} · ${VARIANTS[variant].name}</span>
      <button type="button" data-bar="next">›</button><button type="button" data-bar="full" title="Full screen">${full ? "⤡" : "⤢"}</button>
      <button type="button" data-bar="base" title="What to trace over">${base === "blank" ? "Sample" : "Blank"}</button>
      <button type="button" data-bar="demo" title="Load curved shapes">Demo</button>
      <button type="button" data-bar="tune" title="Tune">⚙</button><button type="button" data-bar="info" title="State">ⓘ</button>`;
  }

  function renderState(): void {
    const closed = shapes.filter((s) => s.closed).length;
    const d = drawing();
    let selText = "none";
    if (selection?.kind === "shape") selText = `shape #${selection.id}`;
    else if (selection?.kind === "point") {
      const s = byId(selection.id)!;
      const i = selection.index;
      const a = s.points[i];
      const e = effective(s, i);
      const own = axisEnd(s, i);
      const fmt = (side: Side) => {
        const h = e[side];
        const how = own && side !== own ? " reflected" : a[side] ? "" : " auto";
        return `${side} ${h ? `(${f(h.x)}, ${f(h.y)})${how}` : "—"}`;
      };
      selText = `point ${i} of #${s.id}: ${a.kind}${own ? " on the axis" : ""} · ${fmt("in")} · ${fmt("out")}`;
    }
    const short = `${shapes.length} shape${shapes.length === 1 ? "" : "s"} (${shapes.length - closed} open) · last: ${logLines[0] ?? "—"}`;
    if (!showDetail) return void (stateEl.textContent = short);
    const lines = [
      `variant ${variant} · show ${tuning.show} · pull ${tuning.pull} · priority ${tuning.priority} · zoom ${(view.s / fitScale()).toFixed(1)}×`,
      `symmetry ${symmetry ? "on" : "off"} · split ${tuning.split} · drawing: ${d ? `#${d.id}, ${d.points.length} pts` : "none"}`,
      `selected: ${selText}`,
      `undo ${undoStack.length} · redo ${redoStack.length} · hit ${tuning.hit}px · double-tap ${tuning.dbl ? `${tuning.dbl}ms` : "off"}`,
      ...shapes.map(
        (s) =>
          `#${s.id} ${s.closed ? "closed" : "open"} ${s.mirror} · ${s.points.map((a) => (a.kind === "smooth" ? (a.in || a.out ? "S" : "s") : a.in || a.out ? "C" : "c")).join("")}`,
      ),
      "  (s smooth auto · S smooth stored · c corner · C corner with handles)",
      "— gestures —",
      ...logLines,
    ];
    stateEl.textContent = lines.join("\n");
  }

  // ---- Controls --------------------------------------------------------------------------------------------
  uiEl.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
    const point = selection?.kind === "point" ? { s: byId(selection.id)!, i: selection.index } : null;
    switch (act) {
      case "sym":
        symmetry = !symmetry;
        log(`Symmetry ${symmetry ? "on" : "off"} (next shape)`);
        return renderAll();
      case "undo":
        return undo("↶ button");
      case "redo":
        return redo("↷ button");
      case "close":
        return closeShape("Close button");
      case "end":
        return endShape("End button");
      case "delete":
        return deleteSelection("Delete button");
      case "clear":
        return clearAll("Clear button");
      case "kind":
        if (point) change("pill → toggle kind", () => log(`→ ${toggleKind(point.s, point.i)}`));
        return;
      case "handles":
        if (point) change("+ Handles → corner gets handles along its edges", () => addHandles(point.s, point.i));
        return;
      case "deselect":
        selection = null;
        log("✓ → deselect");
        return renderAll();
      case "carry":
        if (point) carryOn({ p: point.s.points[point.i], id: point.s.id, index: point.i, reflected: false }, "Carry on button");
        return;
    }
  });

  const setVariant = (next: VariantKey) => {
    if (gesture?.type === "one") cancelOne(gesture);
    gesture = null;
    variant = next;
    tuning.show = VARIANTS[next].show;
    tuning.pull = VARIANTS[next].pull;
    setParam("variant", next);
    setParam("show", null);
    setParam("pull", null);
    log(`switched to ${next}`);
    renderTune();
    renderAll();
  };
  const cycle = (dir: number) => setVariant(KEYS[(KEYS.indexOf(variant) + dir + KEYS.length) % KEYS.length]);
  bar.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-bar]")?.dataset.bar;
    if (act === "prev") cycle(-1);
    else if (act === "next") cycle(1);
    else if (act === "full") {
      full = !full;
      userMoved = false;
      requestAnimationFrame(() => {
        fit();
        renderAll();
      });
      renderAll();
    } else if (act === "tune") tuneEl.hidden = !tuneEl.hidden;
    else if (act === "demo") loadDemo();
    else if (act === "base") {
      const keep = base !== "photo";
      base = base === "blank" ? "sample" : "blank";
      setParam("base", base === "blank" ? "blank" : null);
      setPhoto(base === "blank" ? blankPage() : samplePhoto(demoInk()), keep);
    } else if (act === "info") {
      showDetail = !showDetail;
      stateEl.classList.toggle("detail", showDetail);
      renderAll();
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]") || root.closest("[hidden]")) return;
    if (e.key === "ArrowLeft") cycle(-1);
    else if (e.key === "ArrowRight") cycle(1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") (e.shiftKey ? redo : undo)("Ctrl+Z");
  });

  function setParam(key: string, value: string | null): void {
    const u = new URL(location.href);
    if (value === null) u.searchParams.delete(key);
    else u.searchParams.set(key, value);
    history.replaceState(null, "", u);
  }
  function renderTune(): void {
    const range = (key: "hit" | "zoom" | "hold" | "loupe" | "dbl", label: string, min: number, max: number, step: number) =>
      `<label>${label} <output data-out="${key}">${tuning[key]}</output>
        <input type="range" data-tune="${key}" min="${min}" max="${max}" step="${step}" value="${tuning[key]}" /></label>`;
    const select = (key: "show" | "pull" | "priority" | "split", label: string, options: [string, string][]) =>
      `<label>${label} <select data-tune="${key}">${options
        .map(([v, text]) => `<option value="${v}"${tuning[key] === v ? " selected" : ""}>${text}</option>`)
        .join("")}</select></label>`;
    tuneEl.innerHTML = `
      ${select("show", "Handles shown", [["point", "selected point's only"], ["neighbours", "+ neighbours' on its edges"], ["shape", "whole selected shape"]])}
      ${select("pull", "Handle out of a corner", [["smooth", "Smooth, then Corner"], ["stub", "stubs on the selected corner"], ["pill", "+ Handles in the pill"]])}
      ${select("priority", "Handle vs point in reach", [["nearest", "nearest wins"], ["handles", "handle wins"], ["points", "point wins"]])}
      ${select("split", "New point on a curve", [["smooth", "smooth, splits it exactly"], ["corner", "corner, no handles"]])}
      <label class="check"><input type="checkbox" data-tune="hloupe" ${tuning.hloupe ? "checked" : ""}/> Loupe on handle drags</label>
      ${range("dbl", "Double-tap window (ms, 0 = off)", 0, 600, 50)}
      ${range("hit", "Hit radius (px)", 10, 36, 1)}
      ${range("zoom", "Loupe zoom (×)", 1.5, 6, 0.5)}
      ${range("hold", "Hold before loupe (ms)", 100, 800, 50)}
      ${range("loupe", "Loupe size (px)", 80, 200, 10)}
      <label class="check"><input type="checkbox" data-tune="showHits" ${tuning.showHits ? "checked" : ""}/> Show hit areas</label>
      <button type="button" data-tune-reset>Reset</button>`;
  }
  tuneEl.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.tune;
    if (!key) return;
    let v: string | null;
    if (key === "show") v = tuning.show = el.value as Show;
    else if (key === "pull") v = tuning.pull = el.value as Pull;
    else if (key === "priority") v = tuning.priority = el.value as Priority;
    else if (key === "split") v = tuning.split = el.value as Split;
    else if (key === "hloupe") {
      tuning.hloupe = (el as HTMLInputElement).checked;
      v = tuning.hloupe ? null : "0";
    } else if (key === "showHits") {
      tuning.showHits = (el as HTMLInputElement).checked;
      v = tuning.showHits ? "1" : null;
    }
    else {
      const k = key as "hit" | "zoom" | "hold" | "loupe" | "dbl";
      tuning[k] = Number(el.value);
      v = String(tuning[k]) === String(DEFAULTS[k]) ? null : el.value;
    }
    const out = tuneEl.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = el.value;
    setParam(key, v);
    renderAll();
  });
  tuneEl.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-tune-reset]")) return;
    for (const k of ["hit", "zoom", "hold", "loupe", "dbl", "show", "pull", "priority", "split", "hloupe", "showHits"]) setParam(k, null);
    location.reload();
  });

  renderTune();
  setPhoto(base === "blank" ? blankPage() : samplePhoto(demoInk()));
}

/**
 * Curved shapes as an import would bring them, on the 1200 × 1500 sample with its axis at x = 600: a round eye of
 * four smooth points, a crescent eye with corner tips, and a smile as one symmetric shape (its half runs from the
 * axis at the top lip, out to the corner, and back to the axis at the bottom, both axis points smooth).
 */
function demoShapes(): Shape[] {
  const k = 47;
  return [
    {
      id: 0,
      closed: true,
      mirror: "none",
      points: [
        { x: 420, y: 395, kind: "smooth", in: { x: -k, y: 0 }, out: { x: k, y: 0 } },
        { x: 505, y: 480, kind: "smooth", in: { x: 0, y: -k }, out: { x: 0, y: k } },
        { x: 420, y: 565, kind: "smooth", in: { x: k, y: 0 }, out: { x: -k, y: 0 } },
        { x: 335, y: 480, kind: "smooth", in: { x: 0, y: k }, out: { x: 0, y: -k } },
      ],
    },
    {
      id: 0,
      closed: true,
      mirror: "none",
      points: [
        { x: 760, y: 395, kind: "corner", in: { x: 30, y: 5 }, out: { x: 60, y: 0 } },
        { x: 870, y: 480, kind: "smooth", in: { x: 0, y: -55 }, out: { x: 0, y: 55 } },
        { x: 760, y: 565, kind: "corner", in: { x: 60, y: 0 }, out: { x: 30, y: -5 } },
        { x: 815, y: 480, kind: "smooth", in: { x: 0, y: 45 }, out: { x: 0, y: -45 } },
      ],
    },
    {
      id: 0,
      closed: true,
      mirror: "symmetric",
      points: [
        { x: 600, y: 930, kind: "smooth", out: { x: 110, y: 0 } },
        { x: 850, y: 870, kind: "corner", in: { x: -80, y: 40 }, out: { x: -30, y: 120 } },
        { x: 600, y: 1080, kind: "smooth", in: { x: 140, y: 0 } },
      ],
    },
  ];
}

/** A blank page the sample's size, with a faint grid so panning and zooming still read. */
function blankPage(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  [c.width, c.height] = [1200, 1500];
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbfaf7";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#ebe7de";
  g.lineWidth = 2;
  for (let x = 0; x <= c.width; x += 100) g.strokeRect(x, -1, 0, c.height + 2);
  for (let y = 0; y <= c.height; y += 100) g.strokeRect(-1, y, c.width + 2, 0);
  return c;
}

/** Distance from `p` to the segment `a`–`b`. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Even-odd point-in-polygon. */
function inside(p: Pt, pts: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [a, b] = [pts[i], pts[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** A pumpkin face on paper, standing in until a photo is loaded: the demo shapes inked, plus a nose to trace. */
function samplePhoto(ink: string[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  [c.width, c.height] = [1200, 1500];
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3eee2";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#232323";
  g.lineWidth = 9;
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const d of ink) g.stroke(new Path2D(d));
  g.beginPath();
  g.moveTo(556, 712);
  g.lineTo(646, 706);
  g.lineTo(603, 618);
  g.closePath();
  g.stroke();
  g.fillStyle = "#9a9387";
  g.font = "34px system-ui, sans-serif";
  g.fillText("Sample drawing. Load a photo in Design to trace your own.", 60, 1440);
  return c;
}

function injectStyle(): void {
  const css = `
  .view-handtrace { position: relative; }
  @media not (min-width: 60rem) { .view-handtrace { height: 74svh; } }
  .ht-root { position: absolute; inset: 0; background: #2a2622; overflow: hidden; user-select: none;
    -webkit-user-select: none; -webkit-touch-callout: none; font: 14px system-ui, sans-serif; }
  .ht-root.ht-full { position: fixed; inset: 0; z-index: 50; height: 100dvh; }
  html.ht-noscroll, html.ht-noscroll body { overflow: hidden; }
  .ht-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; display: block; }
  .ht-fill { fill: #ff7a00; fill-opacity: 0.32; fill-rule: evenodd; stroke: none; }
  .ht-line { fill: none; stroke: #ff7a00; stroke-width: 2; stroke-linejoin: round; }
  .ht-line.open { stroke-dasharray: 6 4; }
  .ht-line.drawing { stroke: #ffb347; stroke-width: 2.5; }
  .ht-line.sel { stroke: #39c6ff; stroke-width: 3; }
  .ht-band { fill: none; stroke: #ffd166; stroke-width: 1.5; stroke-dasharray: 4 3; }
  .ht-ghost { fill: none; stroke: #ffd166; stroke-width: 2; }
  .ht-pt { fill: #fff; stroke: #1b1b1b; stroke-width: 1.5; }
  .ht-pt.end { fill: #ffd166; }
  .ht-pt.sel { fill: #39c6ff; stroke: #fff; stroke-width: 2; }
  .ht-pt.closable { fill: #5be37d; }
  .ht-close-ring { fill: none; stroke: #5be37d; stroke-width: 2; stroke-dasharray: 3 2; }
  .ht-marker { fill: #1b1b1b; fill-opacity: 0.6; stroke: #39c6ff; stroke-width: 1.5; }
  .ht-hline { stroke: #39c6ff; stroke-width: 2; }
  .ht-hline.stub { stroke-dasharray: 3 3; }
  .ht-hline.nb { stroke: #b9c4cc; stroke-width: 1; stroke-opacity: 0.8; }
  .ht-knob { fill: #39c6ff; stroke: #fff; stroke-width: 1.5; }
  .ht-knob.nb { fill: #2a2622; fill-opacity: 0.6; stroke: #b9c4cc; stroke-width: 1.5; }
  .ht-stub { fill: rgb(0 0 0 / 0.45); stroke: #39c6ff; stroke-width: 2; }
  .ht-hitarea { fill: #39c6ff; fill-opacity: 0.08; stroke: #39c6ff; stroke-opacity: 0.35; }
  .ht-hitarea.knob { fill: #ff3b6b; stroke: #ff3b6b; }
  .ht-axis { stroke: #8fd3ff; stroke-width: 1.5; stroke-dasharray: 8 6; opacity: 0.8; }
  .ht-axis.hot { stroke: #ffe14d; stroke-width: 3; stroke-dasharray: none; opacity: 1; }
  .ht-loupe { position: absolute; border-radius: 50%; overflow: hidden; border: 3px solid #fff;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.5); background: #2a2622; pointer-events: none; z-index: 3; }
  .ht-loupe[hidden], .ht-note[hidden], .ht-tune[hidden], .ht-proto-bar[hidden], .ht-state[hidden] { display: none; }
  .ht-loupe svg { width: 100%; height: 100%; display: block; }
  .ht-loupe-cross { position: absolute; left: 50%; top: 50%; pointer-events: none; }
  .ht-loupe-cross::before, .ht-loupe-cross::after { content: ""; position: absolute; background: #ff3b6b; }
  .ht-loupe-cross::before { left: -10px; width: 20px; top: -0.5px; height: 1px; }
  .ht-loupe-cross::after { top: -10px; height: 20px; left: -0.5px; width: 1px; }
  .ht-note { position: absolute; left: 50%; transform: translateX(-50%); bottom: 64px; padding: 3px 10px;
    border-radius: 10px; background: rgb(0 0 0 / 0.55); color: #eee; font-size: 12px; pointer-events: none; z-index: 2; }
  .ht-full .ht-note { bottom: auto; top: 104px; white-space: nowrap; }
  .ht-ui button { touch-action: manipulation; font: inherit; color: #f3f3f3; background: rgb(30 30 30 / 0.82);
    border: 1px solid rgb(255 255 255 / 0.25); border-radius: 10px; min-height: 44px; min-width: 44px; padding: 0 12px; }
  .ht-ui button:disabled { opacity: 0.35; }
  .ht-ui button.on { background: #ff7a00; border-color: #ff7a00; color: #111; }
  .ht-ui button.icon { font-size: 20px; padding: 0; }
  .ht-ui > * { position: absolute; z-index: 2; display: flex; gap: 6px; align-items: center; }
  .ht-b-tl { top: 52px; left: 10px; }
  .ht-b-tr { top: 52px; right: 10px; }
  .ht-pill { left: 50%; transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom));
    background: rgb(20 20 20 / 0.85); border-radius: 26px; padding: 6px; max-width: calc(100% - 20px);
    flex-wrap: wrap; justify-content: center; width: max-content; }
  .ht-pill-text { color: #ddd; padding: 0 8px; font-size: 13px; text-align: center; }
  .ht-root:not(.ht-full) .ht-b-tl, .ht-root:not(.ht-full) .ht-b-tr { top: 44px; }
  .ht-proto-bar { position: fixed; top: 6px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex;
    align-items: center; gap: 4px; padding: 3px 6px; border-radius: 18px; background: #6d28d9; color: #fff;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.4); font: 12px system-ui, sans-serif; white-space: nowrap; }
  .ht-bar-name { max-width: 30vw; overflow: hidden; text-overflow: ellipsis; }
  .ht-proto-bar button { font: inherit; font-size: 15px; color: #fff; background: rgb(255 255 255 / 0.15); border: 0;
    border-radius: 12px; min-width: 30px; height: 28px; padding: 0 6px; touch-action: manipulation; }
  .ht-state { position: fixed; top: 44px; left: 6px; z-index: 99; max-width: calc(100vw - 12px); padding: 2px 8px;
    border-radius: 8px; background: rgb(109 40 217 / 0.85); color: #fff; font: 11px ui-monospace, monospace;
    pointer-events: none; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .ht-state:not(.detail) { top: auto; bottom: 4px; left: 4px; opacity: 0.85; }
  .ht-tune { position: fixed; top: 44px; right: 6px; z-index: 101; display: grid; gap: 8px; padding: 10px;
    border-radius: 10px; background: #f6f3ff; color: #222; box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    font: 13px system-ui, sans-serif; width: min(280px, calc(100vw - 12px)); max-height: calc(100dvh - 60px);
    overflow: auto; }
  .ht-tune label { display: grid; gap: 2px; }
  .ht-tune label.check { display: flex; gap: 6px; align-items: center; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
}
