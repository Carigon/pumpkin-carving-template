/**
 * PROTOTYPE — throwaway, for "Placing and adjusting points on a phone" (issue #14, map #4). Not production code:
 * no tests, no a11y, minimal error handling. Lives on the `prototype/hand-trace-touch` branch only.
 *
 * Three touch interaction models for hand-tracing, on a Hand-trace view in the Design step, switchable via
 * `?variant=A|B|C` and the floating bar at the top (← → keys too). All three edit the same in-memory shapes, so
 * one trace can be carried across variants to compare them:
 * - A "Modes + loupe": a Draw | Edit switch. In draw, touching shows where the point goes; holding or dragging
 *   brings up a loupe; lifting places it. In the page, with an action bar along the bottom of the view.
 * - B "Modeless": no mode switch. Tap places (an implicit drawing session), hold for a loupe, drag pans; a
 *   floating pill offers what fits the current state. Full screen.
 * - C "Crosshair": draw mode pans the photo under a fixed crosshair and a big thumb button adds the point (or
 *   closes, ends, moves, carries on, depending on what's under it). Edit works like A's. Full screen, with the
 *   controls on a rail down the right edge.
 * Shared: pinch to zoom and pan; a second finger cancels a one-finger action; two-finger tap undoes, three-finger
 * tap redoes; live symmetry about the photo's vertical centre line (snap and clamp at the axis). ⚙ tunes hit size,
 * loupe zoom, hold delay and loupe size (kept in the URL) and can draw the hit areas; ⤢ flips full screen.
 * Points are in the photo's pixels (y down), not the real design space. With no photo loaded, a drawn sample
 * stands in; loading an image in the Design step replaces it (and clears the shapes).
 */

type Pt = { x: number; y: number };
type Mirror = "none" | "twin" | "symmetric";
interface Shape {
  id: number;
  points: Pt[];
  closed: boolean;
  mirror: Mirror;
}
type VariantKey = "A" | "B" | "C";
type Mode = "draw" | "edit";
type Selection = { kind: "point"; id: number; index: number } | { kind: "shape"; id: number } | null;

/** A point as drawn on screen: a placed point, or its reflection. */
interface Handle {
  p: Pt;
  id: number;
  index: number;
  reflected: boolean;
}
/** An edge as drawn; inserting on it puts a source point at `insertAt`. */
interface Edge {
  a: Pt;
  b: Pt;
  id: number;
  insertAt: number;
  reflected: boolean;
}
interface Geo {
  outlines: { pts: Pt[]; closed: boolean }[];
  handles: Handle[];
  edges: Edge[];
}
type Hit = { kind: "point"; h: Handle } | { kind: "marker"; e: Edge } | { kind: "shape"; id: number } | { kind: "empty" };

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
interface Policy {
  hit(p: Pt): Hit;
  down?(g: OneGesture): void;
  tap(hit: Hit, p: Pt): void;
  hold(g: OneGesture): Action | null;
  drag(g: OneGesture): Action;
}

interface Tuning {
  /** Hit radius on screen, px. */
  hit: number;
  /** Loupe magnification over the current zoom. */
  zoom: number;
  /** Touch-and-hold before the loupe shows, ms. */
  hold: number;
  /** Loupe diameter, px. */
  loupe: number;
  /** One-finger drag on empty space in edit mode (A, C). */
  emptyDrag: "pan" | "nothing";
  showHits: boolean;
}

const VARIANTS: Record<VariantKey, { name: string; full: boolean }> = {
  A: { name: "Modes + loupe", full: false },
  B: { name: "Modeless, floating pill", full: true },
  C: { name: "Crosshair + Add button", full: true },
};
const KEYS = Object.keys(VARIANTS) as VariantKey[];
const DEFAULTS: Tuning = { hit: 22, zoom: 3, hold: 300, loupe: 130, emptyDrag: "pan", showHits: false };
const SLOP = 9;
const TAP_MS = 350;
const MAX_PHOTO = 2400;
const UNDO_DEPTH = 200;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const f = (n: number) => n.toFixed(1);

export function mountHandTracePrototype(root: HTMLElement): void {
  injectStyle();
  const params = new URLSearchParams(location.search);
  let variant: VariantKey = KEYS.find((k) => k === params.get("variant")) ?? "A";
  const tuning: Tuning = {
    hit: Number(params.get("hit")) || DEFAULTS.hit,
    zoom: Number(params.get("zoom")) || DEFAULTS.zoom,
    hold: Number(params.get("hold")) || DEFAULTS.hold,
    loupe: Number(params.get("loupe")) || DEFAULTS.loupe,
    emptyDrag: params.get("emptyDrag") === "nothing" ? "nothing" : "pan",
    showHits: params.get("showHits") === "1",
  };
  let full = VARIANTS[variant].full;

  root.innerHTML = `
    <div class="ht-root">
      <svg class="ht-svg">
        <g class="ht-photo"><image id="ht-photo-img" preserveAspectRatio="none" /></g>
        <g class="ht-over"></g>
      </svg>
      <div class="ht-crosshair" hidden></div>
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
  const crossEl = root.querySelector<HTMLElement>(".ht-crosshair")!;
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
  let mode: Mode = "draw";
  let symmetry = false;
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  const logLines: string[] = [];
  let showDetail = false;

  // Transient display state.
  let preview: Pt | null = null;
  let axisHot = false;
  let crossSnapped = false;
  /** C: a point picked up under the crosshair, following it as the photo pans. */
  let carrying: { id: number; index: number; reflected: boolean; before: string } | null = null;

  const view = { s: 1, tx: 0, ty: 0 };
  let userMoved = false;
  const toScreen = (p: Pt): Pt => ({ x: p.x * view.s + view.tx, y: p.y * view.s + view.ty });
  const toDesign = (p: Pt): Pt => ({ x: (p.x - view.tx) / view.s, y: (p.y - view.ty) / view.s });
  const size = () => ({ w: svg.clientWidth, h: svg.clientHeight });
  const centre = (): Pt => ({ x: size().w / 2, y: size().h / 2 });

  const ax = () => W / 2;
  const reflect = (p: Pt): Pt => ({ x: 2 * ax() - p.x, y: p.y });
  const onAxis = (p: Pt) => Math.abs(p.x - ax()) < 1e-6;
  const byId = (id: number | null) => shapes.find((s) => s.id === id) ?? null;
  const drawing = () => byId(drawingId);

  function log(msg: string): void {
    logLines.unshift(msg);
    logLines.length = Math.min(logLines.length, 6);
  }

  function geometry(s: Shape): Geo {
    const pts = s.points;
    const n = pts.length;
    const handles: Handle[] = pts.map((p, index) => ({ p, id: s.id, index, reflected: false }));
    const edges: Edge[] = [];
    for (let i = 0; i + 1 < n; i++) edges.push({ a: pts[i], b: pts[i + 1], id: s.id, insertAt: i + 1, reflected: false });
    if (s.mirror === "symmetric") {
      // The carver's half joined to its reversed reflection; a join has no length where that end is on the axis.
      const r = pts.map(reflect);
      for (let i = 0; i < n; i++) if (!onAxis(pts[i])) handles.push({ p: r[i], id: s.id, index: i, reflected: true });
      for (let i = 0; i + 1 < n; i++) edges.push({ a: r[i], b: r[i + 1], id: s.id, insertAt: i + 1, reflected: true });
      if (!onAxis(pts[n - 1])) edges.push({ a: pts[n - 1], b: r[n - 1], id: s.id, insertAt: n, reflected: false });
      if (!onAxis(pts[0])) edges.push({ a: r[0], b: pts[0], id: s.id, insertAt: 0, reflected: false });
      const outline = [...pts];
      for (let i = n - 1; i >= 0; i--) if (!onAxis(pts[i])) outline.push(r[i]);
      return { outlines: [{ pts: outline, closed: true }], handles, edges };
    }
    if (s.closed && n >= 2) edges.push({ a: pts[n - 1], b: pts[0], id: s.id, insertAt: n, reflected: false });
    const outlines = [{ pts, closed: s.closed }];
    if (s.mirror === "twin") {
      const r = pts.map(reflect);
      r.forEach((p, index) => handles.push({ p, id: s.id, index, reflected: true }));
      for (const e of [...edges]) edges.push({ ...e, a: reflect(e.a), b: reflect(e.b), reflected: true });
      outlines.push({ pts: r, closed: s.closed });
    }
    return { outlines, handles, edges };
  }

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
      s.points.push(p);
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
  function carryOn(h: Handle, how: string): void {
    const s = byId(h.id)!;
    if (h.index === 0 && s.points.length > 1) s.points.reverse(); // carry on from the first end: same shape
    drawingId = s.id;
    selection = null;
    log(`${how} → carry on #${s.id}`);
    renderAll();
  }
  function insertAt(e: Edge): number {
    const s = byId(e.id)!;
    const m = mid(e.a, e.b);
    s.points.splice(e.insertAt, 0, e.reflected ? reflect(m) : m);
    return e.insertAt;
  }
  function deleteSelection(how: string): void {
    const sel = selection;
    if (!sel) return;
    const s = byId(sel.id)!;
    change(`${how} → delete ${sel.kind}`, () => {
      if (sel.kind === "point") {
        s.points.splice(sel.index, 1);
        const distinct = s.mirror === "symmetric" ? geometry(s).outlines[0].pts.length : s.points.length;
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
  function setMode(next: Mode, how: string): void {
    if (next === mode) return;
    if (next === "edit") drawingId = null;
    else selection = null;
    mode = next;
    log(`${how} → ${next} mode`);
    renderAll();
  }
  const isOpenEnd = (h: Handle) => {
    const s = byId(h.id)!;
    return !s.closed && (h.index === 0 || h.index === s.points.length - 1);
  };

  // ---- Hit testing -----------------------------------------------------------------------------------------
  function hitTest(p: Pt, pointOk: (h: Handle) => boolean, markers: boolean, shapesOk: boolean): Hit {
    const r = tuning.hit;
    let best: Handle | null = null;
    let bestD = r;
    // The shape being drawn wins ties, then later shapes (drawn on top).
    const order = [...shapes].reverse().sort((a, b) => Number(b.id === drawingId) - Number(a.id === drawingId));
    for (const s of order)
      for (const h of geometry(s).handles) {
        if (!pointOk(h)) continue;
        const d = dist(toScreen(h.p), p);
        if (d < bestD) [best, bestD] = [h, d];
      }
    if (best) return { kind: "point", h: best };
    const sel = selection && byId(selection.id);
    if (markers && sel)
      for (const e of visibleMarkers(sel)) if (dist(toScreen(mid(e.a, e.b)), p) < r) return { kind: "marker", e };
    if (shapesOk) {
      const d = toDesign(p);
      for (const s of order) {
        const g = geometry(s);
        const nearEdge = g.edges.some((e) => segDist(p, toScreen(e.a), toScreen(e.b)) < r * 0.6);
        if (nearEdge || g.outlines.some((o) => o.closed && inside(d, o.pts))) return { kind: "shape", id: s.id };
      }
    }
    return { kind: "empty" };
  }
  /** Insert markers: hidden on edges too short on screen (Excalidraw hides them under 40 px). */
  const visibleMarkers = (s: Shape) =>
    geometry(s).edges.filter((e) => dist(toScreen(e.a), toScreen(e.b)) >= Math.max(40, 2.2 * tuning.hit));

  // ---- Actions ---------------------------------------------------------------------------------------------
  function placeAction(g: OneGesture, loupe: boolean): Action {
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
      loupe,
      focus: () => pt,
      move: update,
      end(p) {
        update(p);
        preview = null;
        axisHot = false;
        placePoint(pt, snapped, loupe ? "drag/hold + lift" : "tap");
      },
      cancel() {
        preview = null;
        axisHot = false;
      },
    };
  }
  function dragPointAction(g: OneGesture, h: Handle, before = snapshot(), how = "drag point"): Action {
    const s0 = byId(h.id)!;
    let snapped = onAxis(s0.points[h.index]);
    const grab = { x: toScreen(h.p).x - g.start.x, y: toScreen(h.p).y - g.start.y };
    if (mode === "edit" || variant === "B") selection = { kind: "point", id: h.id, index: h.index };
    const shown = () => {
      const p = byId(h.id)!.points[h.index];
      return h.reflected ? reflect(p) : p;
    };
    return {
      loupe: true,
      focus: shown,
      move(screen) {
        const s = byId(h.id)!;
        let raw = toDesign({ x: screen.x + grab.x, y: screen.y + grab.y });
        if (h.reflected) raw = reflect(raw);
        const r = constrain(s, s.mirror !== "none", raw, h.index, snapped);
        s.points[h.index] = r.p;
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
    const index = insertAt(e);
    const s = byId(e.id)!;
    const p = s.points[index];
    const reflected = e.reflected && !(s.mirror === "symmetric" && onAxis(p));
    const h: Handle = { p: reflected ? reflect(p) : p, id: e.id, index, reflected };
    return dragPointAction({ ...g, start: toScreen(h.p) }, h, before, "drag insert marker → insert + move");
  }
  function dragShapeAction(g: OneGesture, id: number): Action {
    const before = snapshot();
    const orig = byId(id)!.points.map((p) => ({ ...p }));
    const start = toDesign(g.start);
    return {
      loupe: false,
      focus: () => null,
      move(screen) {
        const s = byId(id)!;
        const d = toDesign(screen);
        let dx = d.x - start.x;
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
        s.points = orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
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
  const noop = (how: string): Action => ({ loupe: false, focus: () => null, move() {}, end: () => log(how), cancel() {} });

  // ---- Policies --------------------------------------------------------------------------------------------
  const drawFilter = (h: Handle) => h.id === drawingId || (drawingId === null && isOpenEnd(h));

  /** A tap on a point of the shape being drawn, or on an open end with nothing being drawn (A and C draw). */
  function drawPointTap(h: Handle, how: string, at: Pt | null): void {
    const s = byId(h.id)!;
    if (h.id !== drawingId) return carryOn(h, how);
    if (h.index === s.points.length - 1) return endShape(`${how} on last point`);
    if (h.index === 0) return closeShape(`${how} on first point`);
    if (at) {
      const r = constrain(s, s.mirror !== "none", toDesign(at), -1, false);
      placePoint(r.p, r.snapped, `${how} on a middle point`);
    }
  }

  const editPolicy: Policy = {
    hit: (p) => hitTest(p, () => true, true, true),
    tap(hit) {
      if (hit.kind === "point") {
        selection = { kind: "point", id: hit.h.id, index: hit.h.index };
        log(`tap point → select point${hit.h.reflected ? " (on reflection)" : ""}`);
      } else if (hit.kind === "marker") {
        const e = hit.e;
        return change("tap insert marker → insert", () => {
          const index = insertAt(e);
          selection = { kind: "point", id: e.id, index };
        });
      } else if (hit.kind === "shape") {
        selection = { kind: "shape", id: hit.id };
        log("tap shape → select shape");
      } else {
        selection = null;
        log("tap empty → clear selection");
      }
      renderAll();
    },
    hold(g) {
      if (g.hit.kind === "point") return dragPointAction(g, g.hit.h, undefined, "hold + drag point → move");
      if (g.hit.kind === "marker") return insertDragAction(g, g.hit.e);
      return null;
    },
    drag(g) {
      const hit = g.hit;
      if (hit.kind === "point") return dragPointAction(g, hit.h);
      if (hit.kind === "marker") return insertDragAction(g, hit.e);
      if (hit.kind === "shape" && selection?.kind === "shape" && selection.id === hit.id) return dragShapeAction(g, hit.id);
      const what = hit.kind === "shape" ? "drag unselected shape" : "drag empty";
      return tuning.emptyDrag === "pan" ? panAction(g, `${what} → pan`) : noop(`${what} → nothing`);
    },
  };

  const policyA: Policy = {
    hit: (p) => (mode === "edit" ? editPolicy.hit(p) : hitTest(p, drawFilter, false, false)),
    down(g) {
      if (mode !== "draw" || g.hit.kind !== "empty") return;
      const s = drawing();
      preview = constrain(s, s ? s.mirror !== "none" : symmetry, toDesign(g.start), -1, false).p;
    },
    tap(hit, p) {
      if (mode === "edit") return editPolicy.tap(hit, p);
      preview = null;
      if (hit.kind === "point") return drawPointTap(hit.h, "tap", p);
      const s = drawing();
      const r = constrain(s, s ? s.mirror !== "none" : symmetry, toDesign(p), -1, false);
      placePoint(r.p, r.snapped, "tap");
    },
    hold(g) {
      if (mode === "edit") return editPolicy.hold(g);
      if (g.hit.kind === "point")
        return g.hit.h.id === drawingId ? dragPointAction(g, g.hit.h, undefined, "hold + drag point → move") : null;
      return placeAction(g, true);
    },
    drag(g) {
      if (mode === "edit") return editPolicy.drag(g);
      if (g.hit.kind === "point" && g.hit.h.id === drawingId) return dragPointAction(g, g.hit.h);
      return placeAction(g, true);
    },
  };

  const policyB: Policy = {
    hit: (p) => hitTest(p, () => true, drawingId === null, true),
    tap(hit, p) {
      const s = drawing();
      if (s) {
        if (hit.kind === "point" && hit.h.id === s.id) return drawPointTap(hit.h, "tap", p);
        if (hit.kind === "point") {
          drawingId = null;
          selection = { kind: "point", id: hit.h.id, index: hit.h.index };
          log("tap another shape's point while drawing → end drawing + select");
          return renderAll();
        }
        const r = constrain(s, s.mirror !== "none", toDesign(p), -1, false);
        return placePoint(r.p, r.snapped, "tap");
      }
      if (selection) {
        if (hit.kind === "empty") {
          selection = null;
          log("tap empty → deselect (no point placed)");
          return renderAll();
        }
        return editPolicy.tap(hit, p);
      }
      if (hit.kind === "empty") {
        const r = constrain(null, symmetry, toDesign(p), -1, false);
        return placePoint(r.p, r.snapped, "tap empty");
      }
      editPolicy.tap(hit, p);
    },
    hold(g) {
      if (g.hit.kind === "point") return dragPointAction(g, g.hit.h, undefined, "hold + drag point → move");
      if (g.hit.kind === "marker") return insertDragAction(g, g.hit.e);
      if (drawingId !== null || !selection) return placeAction(g, true);
      return null;
    },
    drag(g) {
      const hit = g.hit;
      if (hit.kind === "point") return dragPointAction(g, hit.h);
      if (hit.kind === "marker") return insertDragAction(g, hit.e);
      if (hit.kind === "shape" && selection?.kind === "shape" && selection.id === hit.id) return dragShapeAction(g, hit.id);
      return panAction(g);
    },
  };

  const policyC: Policy = {
    hit: (p) => (mode === "edit" ? editPolicy.hit(p) : { kind: "empty" }),
    tap(hit, p) {
      if (mode === "edit") return editPolicy.tap(hit, p);
      recentre(p);
      log("tap → bring that spot under the crosshair");
    },
    hold: (g) => (mode === "edit" ? editPolicy.hold(g) : null),
    drag: (g) => (mode === "edit" ? editPolicy.drag(g) : panAction(g, "drag → pan under crosshair")),
  };
  const policy = (): Policy => ({ A: policyA, B: policyB, C: policyC })[variant];

  /** C: what the crosshair is over, by draw mode's rules. */
  const crossTarget = (): Hit => hitTest(centre(), drawFilter, false, false);
  function crossPrimary(): { label: string; act: string } {
    if (carrying) return { label: "Drop", act: "drop" };
    const t = crossTarget();
    if (t.kind === "point") {
      const s = byId(t.h.id)!;
      if (t.h.id !== drawingId) return { label: "Carry on", act: "primary" };
      if (t.h.index === s.points.length - 1) return { label: "End", act: "primary" };
      if (t.h.index === 0) return { label: s.points.length >= 3 ? "Close" : "Add point", act: "primary" };
      return { label: "Move point", act: "primary" };
    }
    return { label: "Add point", act: "primary" };
  }
  function crossPrimaryAct(): void {
    const t = crossTarget();
    if (t.kind === "point") {
      const s = byId(t.h.id)!;
      const isMiddle = t.h.id === drawingId && t.h.index > 0 && t.h.index < s.points.length - 1;
      const tinyFirst = t.h.id === drawingId && t.h.index === 0 && s.points.length < 3 && s.points.length > 1;
      if (isMiddle) {
        carrying = { id: t.h.id, index: t.h.index, reflected: t.h.reflected, before: snapshot() };
        recentre(toScreen(t.h.p));
        log("Move point → picked up; pan, then Drop");
        return renderAll();
      }
      if (!tinyFirst) return drawPointTap(t.h, "button", null);
    }
    const s = drawing();
    const r = constrain(s, s ? s.mirror !== "none" : symmetry, toDesign(centre()), -1, crossSnapped);
    placePoint(r.p, r.snapped, "Add point button");
  }
  function crossDrop(): void {
    if (!carrying) return;
    pushUndo(carrying.before);
    carrying = null;
    log("Drop → point moved");
    renderAll();
  }
  /** C draw: keep the preview (and a carried point) under the crosshair as the photo moves. */
  function crossUpdate(): void {
    if (variant !== "C" || mode !== "draw") return;
    const c = toDesign(centre());
    if (carrying) {
      const s = byId(carrying.id);
      if (!s) return void (carrying = null);
      const raw = carrying.reflected ? reflect(c) : c;
      const r = constrain(s, s.mirror !== "none", raw, carrying.index, crossSnapped);
      s.points[carrying.index] = r.p;
      crossSnapped = r.snapped;
      axisHot = s.mirror !== "none" && r.snapped;
      preview = null;
      return;
    }
    const s = drawing();
    const mirrored = s ? s.mirror !== "none" : symmetry;
    const r = constrain(s, mirrored, c, -1, crossSnapped);
    crossSnapped = r.snapped;
    axisHot = mirrored && r.snapped;
    preview = r.p;
  }
  function recentre(p: Pt): void {
    const c = centre();
    const [x0, y0] = [view.tx, view.ty];
    const [dx, dy] = [c.x - p.x, c.y - p.y];
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 160);
      const e = 1 - (1 - k) * (1 - k);
      view.tx = x0 + dx * e;
      view.ty = y0 + dy * e;
      render();
      if (k < 1) requestAnimationFrame(step);
    };
    userMoved = true;
    requestAnimationFrame(step);
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
      const g: OneGesture = {
        type: "one",
        id: e.pointerId,
        start: p,
        last: p,
        hit: policy().hit(p),
        active: null,
        t0: performance.now(),
      };
      g.timer = window.setTimeout(() => {
        if (gesture !== g || g.active) return;
        g.active = policy().hold(g);
        if (g.active) g.active.move(g.last);
        render();
      }, tuning.hold);
      gesture = g;
      policy().down?.(g);
      render();
      return;
    }
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
        gesture.active = policy().drag(gesture);
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
      else if (g.active) g.active.end(p);
      else policy().tap(g.hit, g.start);
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

  function setPhoto(src: CanvasImageSource & { width: number; height: number }): void {
    const k = Math.min(1, MAX_PHOTO / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    [W, H] = [c.width, c.height];
    photoImg.setAttribute("href", c.toDataURL("image/jpeg", 0.9));
    photoImg.setAttribute("width", String(W));
    photoImg.setAttribute("height", String(H));
    shapes = [];
    undoStack = [];
    redoStack = [];
    drawingId = null;
    selection = null;
    carrying = null;
    mode = "draw";
    userMoved = false;
    fit();
    log(`photo ${W}×${H} loaded`);
    renderAll();
  }
  window.addEventListener("prototype-photo", (e) => setPhoto((e as CustomEvent<ImageBitmap>).detail));

  // ---- Rendering -------------------------------------------------------------------------------------------
  const axisShown = () => {
    const sel = selection && byId(selection.id);
    const mirroredSel = !!sel && sel.mirror !== "none";
    const d = drawing();
    return (symmetry && (variant === "B" || mode === "draw")) || mirroredSel || (!!d && d.mirror !== "none");
  };

  /** The overlay in some screen mapping: the main view (`dot` = 1) or the loupe. */
  function overlay(map: (p: Pt) => Pt, dot: number, hits: boolean): string {
    const out: string[] = [];
    const pathOf = (pts: Pt[], closed: boolean) =>
      pts.map((p, i) => `${i ? "L" : "M"}${f(map(p).x)} ${f(map(p).y)}`).join("") + (closed ? "Z" : "");
    if (axisShown()) {
      const [a, b] = [map({ x: ax(), y: 0 }), map({ x: ax(), y: H })];
      out.push(`<line class="ht-axis${axisHot ? " hot" : ""}" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"/>`);
    }
    const geos = shapes.map((s) => ({ s, g: geometry(s) }));
    const fill = geos.flatMap(({ g }) => g.outlines.filter((o) => o.closed && o.pts.length > 2).map((o) => pathOf(o.pts, true)));
    if (fill.length) out.push(`<path class="ht-fill" d="${fill.join("")}"/>`);
    const selId = selection?.id ?? null;
    for (const { s, g } of geos) {
      const cls = `ht-line${s.id === selId ? " sel" : ""}${s.id === drawingId ? " drawing" : ""}${s.closed ? "" : " open"}`;
      for (const o of g.outlines) out.push(`<path class="${cls}" d="${pathOf(o.pts, o.closed)}"/>`);
    }
    // Rubber band from the last point to where the next point would go (only while a finger is down, or C).
    const d = drawing();
    if (preview) {
      const from = d?.points.at(-1);
      const pr = [preview, ...(d?.mirror !== "none" && (d || symmetry) ? [reflect(preview)] : [])];
      if (from) {
        out.push(`<path class="ht-band" d="${pathOf([from, preview], false)}"/>`);
        if (d && d.mirror !== "none") out.push(`<path class="ht-band" d="${pathOf([reflect(from), reflect(preview)], false)}"/>`);
      }
      for (const p of pr) out.push(`<circle class="ht-ghost" cx="${f(map(p).x)}" cy="${f(map(p).y)}" r="${6 * dot}"/>`);
    }
    // Insert markers on the selected shape.
    const sel = selection && byId(selection.id);
    if (sel && (variant === "B" || mode === "edit") && drawingId === null)
      for (const e of visibleMarkers(sel)) {
        const m = map(mid(e.a, e.b));
        out.push(`<rect class="ht-marker" x="${f(m.x - 4 * dot)}" y="${f(m.y - 4 * dot)}" width="${8 * dot}" height="${8 * dot}" transform="rotate(45 ${f(m.x)} ${f(m.y)})"/>`);
        if (hits) out.push(`<circle class="ht-hitarea" cx="${f(m.x)}" cy="${f(m.y)}" r="${tuning.hit}"/>`);
      }
    // Points.
    for (const { s, g } of geos) {
      const showAll = variant === "B" || mode === "edit" || s.id === drawingId;
      for (const h of g.handles) {
        const end = !s.closed && (h.index === 0 || h.index === s.points.length - 1);
        if (!showAll && !(drawingId === null && end)) continue;
        const m = map(h.p);
        const isSel = selection?.kind === "point" && selection.id === s.id && selection.index === h.index;
        const closable = s.id === drawingId && h.index === 0 && s.points.length >= 3;
        let cls = "ht-pt";
        if (isSel) cls += " sel";
        if (end) cls += " end";
        if (closable) cls += " closable";
        const r = (s.id === drawingId || s.id === selId ? 5.5 : 4) * dot;
        if (closable) out.push(`<circle class="ht-close-ring" cx="${f(m.x)}" cy="${f(m.y)}" r="${11 * dot}"/>`);
        out.push(`<circle class="${cls}" cx="${f(m.x)}" cy="${f(m.y)}" r="${r}"/>`);
        if (hits) out.push(`<circle class="ht-hitarea" cx="${f(m.x)}" cy="${f(m.y)}" r="${tuning.hit}"/>`);
      }
    }
    return out.join("");
  }

  function render(): void {
    if (!userMoved) fit();
    crossUpdate();
    photoG.setAttribute("transform", `matrix(${view.s} 0 0 ${view.s} ${view.tx} ${view.ty})`);
    overG.innerHTML = overlay(toScreen, 1, tuning.showHits);
    crossEl.hidden = !(variant === "C" && mode === "draw");
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
    htRoot.dataset.variant = variant;
    const d = drawing();
    const n = d?.points.length ?? 0;
    const can = { undo: undoStack.length > 0, redo: redoStack.length > 0, sel: selection !== null, clear: shapes.length > 0 };
    const btn = (act: string, label: string, enabled = true, extra = "") =>
      `<button type="button" data-act="${act}" class="${extra}" ${enabled ? "" : "disabled"}>${label}</button>`;
    const sym = btn("sym", `⇋ Symmetry ${symmetry ? "on" : "off"}`, true, symmetry ? "on" : "");
    const undoRedo = btn("undo", "↶", can.undo, "icon") + btn("redo", "↷", can.redo, "icon");
    const modes = (vertical: boolean) =>
      `<div class="ht-seg${vertical ? " vertical" : ""}">${btn("draw", "✎ Draw", true, mode === "draw" ? "on" : "")}${btn("edit", "↖ Edit", true, mode === "edit" ? "on" : "")}</div>`;
    let html: string;
    if (variant === "A") {
      html = `<div class="ht-a-top">${modes(false)}${mode === "draw" ? sym : ""}</div>
        <div class="ht-a-bar">${undoRedo}<span class="sep"></span>${
          mode === "draw"
            ? btn("close", "Close", n >= 3) + btn("end", "End", n > 0)
            : btn("delete", selection?.kind === "shape" ? "Delete shape" : "Delete point", can.sel)
        }<span class="sep"></span>${btn("clear", "Clear", can.clear)}</div>`;
    } else if (variant === "B") {
      let pill: string;
      if (d) pill = `<span class="ht-pill-text">Drawing · ${n} pt${n === 1 ? "" : "s"}</span>${btn("close", "Close", n >= 3)}${btn("end", "End")}`;
      else if (selection?.kind === "point") {
        const s = byId(selection.id)!;
        const end = !s.closed && (selection.index === 0 || selection.index === s.points.length - 1);
        pill = btn("delete", "Delete point") + (end ? btn("carry", "Carry on") : "") + btn("deselect", "Done");
      } else if (selection?.kind === "shape") pill = btn("delete", "Delete shape") + btn("deselect", "Done");
      else pill = `<span class="ht-pill-text">Tap to place · hold for loupe · drag to pan</span>`;
      html = `<div class="ht-b-tl">${undoRedo}</div><div class="ht-b-tr">${sym}${btn("clear", "Clear", can.clear)}</div>
        <div class="ht-pill">${pill}</div>`;
    } else {
      const primary = crossPrimary();
      html = `<div class="ht-c-rail">${modes(true)}${mode === "draw" ? sym : ""}${undoRedo}${
        mode === "edit" ? btn("delete", "Delete", can.sel) : ""
      }${btn("clear", "Clear", can.clear)}</div>${
        mode === "draw"
          ? `<div class="ht-c-act">${btn("close", "Close", n >= 3, "small")}${btn("end", "End", n > 0, "small")}${btn(
              primary.act,
              primary.label,
              true,
              "primary",
            )}</div>`
          : ""
      }`;
    }
    if (html !== uiKey) {
      uiKey = html;
      uiEl.innerHTML = html;
    }
    const open = shapes.filter((s) => !s.closed).length;
    noteEl.hidden = open === 0;
    noteEl.textContent = `${open} shape${open === 1 ? " isn't" : "s aren't"} closed and won't be carved`;

    bar.innerHTML = `<button type="button" data-bar="prev">‹</button><span>${variant} · ${VARIANTS[variant].name}</span>
      <button type="button" data-bar="next">›</button><button type="button" data-bar="full" title="Full screen">${full ? "⤡" : "⤢"}</button>
      <button type="button" data-bar="tune" title="Tune">⚙</button><button type="button" data-bar="info" title="State">ⓘ</button>`;
  }

  function renderState(): void {
    const closed = shapes.filter((s) => s.closed).length;
    const d = drawing();
    const sel = selection
      ? selection.kind === "point"
        ? `point ${selection.index} of #${selection.id}`
        : `shape #${selection.id}`
      : "none";
    const modeText = variant === "B" ? (d ? "drawing session" : "modeless") : mode;
    const short = `${modeText} · ${shapes.length} shape${shapes.length === 1 ? "" : "s"} (${shapes.length - closed} open) · last: ${logLines[0] ?? "—"}`;
    if (!showDetail) return void (stateEl.textContent = short);
    const lines = [
      `variant ${variant} · ${modeText} · symmetry ${symmetry ? "on" : "off"} · zoom ${(view.s / fitScale()).toFixed(1)}×`,
      `drawing: ${d ? `#${d.id}, ${d.points.length} pts${d.mirror !== "none" ? ", mirrored" : ""}` : "none"} · selected: ${sel}`,
      `undo ${undoStack.length} · redo ${redoStack.length} · hit ${tuning.hit}px radius`,
      ...shapes.map((s) => `#${s.id} ${s.closed ? "closed" : "open"} ${s.mirror} · ${s.points.length} pts`),
      "— gestures —",
      ...logLines,
    ];
    stateEl.textContent = lines.join("\n");
  }

  // ---- Controls --------------------------------------------------------------------------------------------
  uiEl.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
    switch (act) {
      case "draw":
      case "edit":
        return setMode(act, "mode switch");
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
      case "deselect":
        selection = null;
        log("Done → deselect");
        return renderAll();
      case "carry":
        if (selection?.kind === "point") {
          const s = byId(selection.id)!;
          carryOn({ p: s.points[selection.index], id: s.id, index: selection.index, reflected: false }, "Carry on button");
        }
        return;
      case "primary":
        return crossPrimaryAct();
      case "drop":
        return crossDrop();
    }
  });

  const setVariant = (next: VariantKey) => {
    if (gesture?.type === "one") cancelOne(gesture);
    gesture = null;
    if (carrying) crossDrop();
    variant = next;
    full = VARIANTS[next].full;
    if (next === "B") mode = "draw";
    else mode = shapes.some((s) => s.closed) && drawingId === null ? "edit" : "draw";
    if (mode === "draw" && next !== "B") selection = null;
    setParam("variant", next);
    log(`switched to ${next}`);
    userMoved = false;
    requestAnimationFrame(() => {
      fit();
      renderAll();
    });
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
    else if (act === "info") {
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
  const range = (key: "hit" | "zoom" | "hold" | "loupe", label: string, min: number, max: number, step: number) =>
    `<label>${label} <output data-out="${key}">${tuning[key]}</output>
      <input type="range" data-tune="${key}" min="${min}" max="${max}" step="${step}" value="${tuning[key]}" /></label>`;
  tuneEl.innerHTML = `
    ${range("hit", "Hit radius (px)", 10, 36, 1)}
    ${range("zoom", "Loupe zoom (×)", 1.5, 6, 0.5)}
    ${range("hold", "Hold before loupe (ms)", 100, 800, 50)}
    ${range("loupe", "Loupe size (px)", 80, 200, 10)}
    <label>Edit: drag on empty space
      <select data-tune="emptyDrag"><option value="pan">pans</option><option value="nothing">does nothing</option></select></label>
    <label class="check"><input type="checkbox" data-tune="showHits" ${tuning.showHits ? "checked" : ""}/> Show hit areas</label>
    <button type="button" data-tune-reset>Reset</button>`;
  tuneEl.querySelector<HTMLSelectElement>("select")!.value = tuning.emptyDrag;
  tuneEl.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.tune as keyof Tuning | undefined;
    if (!key) return;
    if (key === "emptyDrag") tuning.emptyDrag = el.value === "nothing" ? "nothing" : "pan";
    else if (key === "showHits") tuning.showHits = (el as HTMLInputElement).checked;
    else tuning[key] = Number(el.value);
    const out = tuneEl.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = el.value;
    const v = key === "showHits" ? (tuning.showHits ? "1" : null) : String(tuning[key]);
    setParam(key, v === String(DEFAULTS[key]) ? null : v);
    renderAll();
  });
  tuneEl.querySelector("[data-tune-reset]")!.addEventListener("click", () => {
    for (const k of Object.keys(DEFAULTS)) setParam(k, null);
    location.reload();
  });

  setPhoto(samplePhoto());
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

/** A hand-drawn-looking pumpkin face on paper, standing in until a photo is loaded. */
function samplePhoto(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  [c.width, c.height] = [1200, 1500];
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3eee2";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#232323";
  g.lineWidth = 9;
  g.lineJoin = "round";
  g.lineCap = "round";
  const wobbly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [jx, jy] = [x + Math.sin(i * 2.3 + y) * 5, y + Math.cos(i * 1.7 + x) * 5];
      if (i) g.lineTo(jx, jy);
      else g.moveTo(jx, jy);
    });
    g.closePath();
    g.stroke();
  };
  wobbly([[320, 530], [475, 525], [405, 375]]);
  wobbly([[728, 522], [884, 532], [796, 382]]);
  wobbly([[558, 712], [646, 706], [603, 618]]);
  wobbly([
    [296, 905], [378, 968], [432, 912], [492, 985], [556, 924], [602, 996], [646, 926], [712, 984],
    [768, 914], [822, 966], [906, 900], [826, 1086], [600, 1128], [378, 1080],
  ]);
  g.beginPath();
  g.arc(408, 478, 22, 0, Math.PI * 2);
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
  .ht-hitarea { fill: #39c6ff; fill-opacity: 0.08; stroke: #39c6ff; stroke-opacity: 0.35; }
  .ht-axis { stroke: #8fd3ff; stroke-width: 1.5; stroke-dasharray: 8 6; opacity: 0.8; }
  .ht-axis.hot { stroke: #ffe14d; stroke-width: 3; stroke-dasharray: none; opacity: 1; }
  .ht-loupe { position: absolute; border-radius: 50%; overflow: hidden; border: 3px solid #fff;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.5); background: #2a2622; pointer-events: none; z-index: 3; }
  .ht-loupe[hidden], .ht-crosshair[hidden], .ht-note[hidden], .ht-tune[hidden], .ht-proto-bar[hidden],
  .ht-state[hidden] { display: none; }
  .ht-loupe svg { width: 100%; height: 100%; display: block; }
  .ht-loupe-cross, .ht-crosshair { position: absolute; left: 50%; top: 50%; pointer-events: none; }
  .ht-loupe-cross::before, .ht-loupe-cross::after, .ht-crosshair::before, .ht-crosshair::after {
    content: ""; position: absolute; background: #ff3b6b; }
  .ht-loupe-cross::before { left: -10px; width: 20px; top: -0.5px; height: 1px; }
  .ht-loupe-cross::after { top: -10px; height: 20px; left: -0.5px; width: 1px; }
  .ht-crosshair { width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 2px solid #fff; border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6), inset 0 0 0 1px rgb(0 0 0 / 0.6); }
  .ht-crosshair::before { left: 15px; width: 2px; top: -12px; height: 56px; background: rgb(255 59 107 / 0.9); }
  .ht-crosshair::after { top: 15px; height: 2px; left: -12px; width: 56px; background: rgb(255 59 107 / 0.9); }
  .ht-note { position: absolute; left: 50%; transform: translateX(-50%); bottom: 64px; padding: 3px 10px;
    border-radius: 10px; background: rgb(0 0 0 / 0.55); color: #eee; font-size: 12px; pointer-events: none; z-index: 2; }
  .ht-full .ht-note { bottom: auto; top: 104px; white-space: nowrap; }
  .ht-ui button { touch-action: manipulation; font: inherit; color: #f3f3f3; background: rgb(30 30 30 / 0.82);
    border: 1px solid rgb(255 255 255 / 0.25); border-radius: 10px; min-height: 44px; min-width: 44px; padding: 0 12px; }
  .ht-ui button:disabled { opacity: 0.35; }
  .ht-ui button.on { background: #ff7a00; border-color: #ff7a00; color: #111; }
  .ht-ui button.icon { font-size: 20px; padding: 0; }
  .ht-ui > * { position: absolute; z-index: 2; display: flex; gap: 6px; align-items: center; }
  .ht-seg { display: flex; }
  .ht-seg button { border-radius: 0; }
  .ht-seg button:first-child { border-radius: 10px 0 0 10px; }
  .ht-seg button:last-child { border-radius: 0 10px 10px 0; }
  .ht-seg.vertical { flex-direction: column; }
  .ht-seg.vertical button:first-child { border-radius: 10px 10px 0 0; }
  .ht-seg.vertical button:last-child { border-radius: 0 0 10px 10px; }
  .ht-a-top { top: 8px; right: 8px; flex-direction: column; align-items: flex-end; }
  .ht-a-bar { left: 0; right: 0; bottom: 0; padding: 8px; justify-content: center; flex-wrap: wrap;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.5)); }
  .ht-a-bar .sep { width: 10px; }
  .ht-b-tl { top: 52px; left: 10px; }
  .ht-b-tr { top: 52px; right: 10px; }
  .ht-pill { left: 50%; transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom));
    background: rgb(20 20 20 / 0.85); border-radius: 26px; padding: 6px; max-width: calc(100% - 20px); }
  .ht-pill-text { color: #ddd; padding: 0 8px; font-size: 13px; white-space: nowrap; }
  .ht-c-rail { right: 8px; top: 50%; transform: translateY(-50%); flex-direction: column; }
  .ht-c-act { right: 72px; bottom: calc(22px + env(safe-area-inset-bottom)); align-items: flex-end; }
  .ht-c-act .primary { min-width: 96px; min-height: 96px; border-radius: 50%; background: #ff7a00; color: #111;
    font-weight: 700; border: 3px solid #fff; }
  .ht-c-act .small { min-height: 40px; }
  .ht-root:not(.ht-full) .ht-b-tl, .ht-root:not(.ht-full) .ht-b-tr { top: 44px; }
  .ht-proto-bar { position: fixed; top: 6px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex;
    align-items: center; gap: 4px; padding: 3px 6px; border-radius: 18px; background: #6d28d9; color: #fff;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.4); font: 12px system-ui, sans-serif; white-space: nowrap; }
  .ht-proto-bar button { font: inherit; font-size: 15px; color: #fff; background: rgb(255 255 255 / 0.15); border: 0;
    border-radius: 12px; min-width: 30px; height: 28px; touch-action: manipulation; }
  .ht-state { position: fixed; top: 44px; left: 6px; z-index: 99; max-width: calc(100vw - 12px); padding: 2px 8px;
    border-radius: 8px; background: rgb(109 40 217 / 0.85); color: #fff; font: 11px ui-monospace, monospace;
    pointer-events: none; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .ht-state:not(.detail) { top: auto; bottom: 4px; left: 4px; opacity: 0.85; }
  .ht-tune { position: fixed; top: 44px; right: 6px; z-index: 101; display: grid; gap: 8px; padding: 10px;
    border-radius: 10px; background: #f6f3ff; color: #222; box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    font: 13px system-ui, sans-serif; width: min(280px, calc(100vw - 12px)); }
  .ht-tune label { display: grid; gap: 2px; }
  .ht-tune label.check { display: flex; gap: 6px; align-items: center; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
}
