import { fitProfile, type Point2, type ProfileFit, type PumpkinMeasurements, type Units } from "../core";
import {
  blueprintView,
  clampZoom,
  describeSelection,
  fitScale,
  HANDLE_WIDTH,
  MIN_ZOOM,
  type BlueprintDrawing,
  type BlueprintLabel,
  type GapRef,
} from "../blueprintView";
import { tapeLength } from "../displayUnits";
import { ballMeasurements } from "../input/calibrationGrid";
import type { MeasureState } from "../measureState";
import {
  deleteRing,
  dragBall,
  dragHeight,
  dragRing,
  insertRing,
  nudgeLength,
  sortRings,
  type ClampNote,
  type Gap,
  type RingEdit,
  type RingId,
  type RingMeasurements,
  type RingWithId,
} from "../ringEdits";
import type { ConfirmDelete } from "./deleteConfirm";

const SVG = "http://www.w3.org/2000/svg";
/** Each zoom step (a button press or a +/− key), as a factor. */
const ZOOM_STEP = 1.25;
/** How much one wheel notch (100 px of deltaY) zooms: about 14 %. */
const WHEEL_RATE = 0.0015;
/** A handle's hit radius, px. */
const HIT_RADIUS = 22;
/** How long the scale takes to ease to the new fit after a drag, ms. */
const THAW_MS = 220;
/** While an arrow key is held, the 3D view and the template rebuild at most this often, ms. */
const NUDGE_REBUILD_MS = 250;
/** How long the live region waits for held keys to settle before reading out, ms. */
const ANNOUNCE_MS = 400;
/** How long a refused insert or delete's note stays up, ms. */
const NOTE_MS = 4000;

export interface BlueprintPane {
  /**
   * The shared state changed (measurements, selection or hover): refit the profile if need be and redraw. In
   * test-grid mode the first ring is the ball, drawn as a circle, and nothing is selected.
   */
  show(state: MeasureState, ball: boolean): void;
  /** Label the ruler and the rings in these display units. */
  setUnits(units: Units): void;
}

export interface BlueprintOptions {
  /**
   * The view changed the shared state: a drag, nudge, insert or delete (with `lastEdited` for the ring edited),
   * or the selection or hover. While a drag or held key goes on, `live` is true, once per animation frame; a last
   * change with `live: false` comes when it ends.
   */
  change(patch: Partial<MeasureState>, live: boolean): void;
  /** Asks before the × deletes a ring (unless asking is turned off); shared with the form. */
  confirmDelete: ConfirmDelete;
}

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
 * Clicking a ring's line or label selects it (as does dragging its handle); the selected ring shows a × that
 * deletes it, asking first. Hovering a gap shows where a ring would go, and clicking adds it there.
 * The view is one Tab stop: Page Up / Page Down move the selection through the height line and the rings, the
 * arrows nudge it by one snap step, Delete deletes the selected ring without asking, Escape clears the selection,
 * and a polite live region reads out the selection and nudged values.
 * Zoom (0.25× to 1×, anchored at the bottom middle) comes from the stacked buttons, the scroll wheel and the +/−
 * keys while the view has focus; it isn't saved. The geometry is `blueprintView`; this only draws it as SVG at
 * the element's size in px and handles the pointer and keys.
 */
export function mountBlueprintView(root: HTMLElement, options: BlueprintOptions): BlueprintPane {
  root.innerHTML = `
    <svg class="bp-svg" tabindex="0" role="application" aria-roledescription="blueprint"
      aria-label="Blueprint: the pumpkin's profile drawn to scale, with each ring as a line. Page Up and Page Down select the height or a ring, the arrow keys nudge it, Delete deletes the selected ring, + and − zoom."></svg>
    <div class="bp-banner" hidden></div>
    <div class="bp-note" role="status" hidden></div>
    <div class="bp-live visually-hidden" aria-live="polite"></div>
    <div class="bp-zoom" role="group" aria-label="Zoom">
      <button type="button" data-zoom="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
      <button type="button" data-zoom="fit" title="Fit the pumpkin" aria-label="Fit the pumpkin">⤢</button>
    </div>
  `;
  const svg = root.querySelector<SVGSVGElement>(".bp-svg")!;
  const banner = root.querySelector<HTMLElement>(".bp-banner")!;
  const noteEl = root.querySelector<HTMLElement>(".bp-note")!;
  const live = root.querySelector<HTMLElement>(".bp-live")!;
  const buttons = Object.fromEntries(
    [...root.querySelectorAll<HTMLButtonElement>("[data-zoom]")].map((b) => [b.dataset.zoom, b]),
  ) as Record<"in" | "out" | "fit", HTMLButtonElement>;

  let state: MeasureState = {
    measurements: { height: Number.NaN, rings: [] },
    lastEdited: null,
    selected: null,
    hovered: null,
  };
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
  /** A pointer is down: focus from a click doesn't select the top ring. */
  let pointerDown = false;
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
  const rings = () => state.measurements.rings;
  const indexOf = (id: RingId | null) => (id === null ? -1 : rings().findIndex((r) => r.id === id));
  /** A ring's id from a drawn index. */
  const idAt = (index: number | null) => (index === null ? null : (rings()[index]?.id ?? null));
  /** The selection as the drawing takes it: an index, the height, or none. */
  const selectedRef = () => {
    const { selected } = state;
    if (selected === "height") return "height" as const;
    const i = indexOf(selected);
    return i < 0 ? null : i;
  };
  const hoveredRef = (): number | GapRef | null => {
    const { hovered } = state;
    if (hovered === null) return null;
    if (typeof hovered === "number") return indexOf(hovered) < 0 ? null : indexOf(hovered);
    return { above: hovered.above === null ? null : indexOf(hovered.above), below: hovered.below === null ? null : indexOf(hovered.below) };
  };

  const render = () => {
    buttons.in.disabled = buttons.fit.disabled = zoom >= 1;
    buttons.out.disabled = zoom <= MIN_ZOOM;
    const view = size();
    // Hidden (another view showing): drawn when it next shows and gets a size.
    if (view.width === 0 || view.height === 0) return;
    const measurements = drawn();
    shownScale = heldScale ?? fitScale({ measurements, fit, size: view, units });
    const blamed = indexOf(state.lastEdited);
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
      selected: selectedRef(),
      // No ghost ring while a handle is dragged.
      hovered: drag ? null : hoveredRef(),
    });
    svg.replaceChildren(...draw(shown));
    banner.textContent = shown.banner ?? "";
    banner.hidden = shown.banner === null;
  };

  /** Change the shared state from here: take it locally, redraw and pass it on. */
  const emit = (patch: Partial<MeasureState>, isLive = false) => {
    state = { ...state, ...patch };
    if (patch.measurements) refit();
    render();
    options.change(patch, isLive);
  };

  // The live region, debounced so held keys don't flood it.
  let announceTimer = 0;
  let toggle = false;
  const announce = (text: string) => {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      // A trailing no-break space every other time, so the same words twice still change and are read twice.
      toggle = !toggle;
      live.textContent = toggle ? text : `${text} `;
    }, ANNOUNCE_MS);
  };
  const describe = (selected: RingId | "height" | null) => {
    if (selected === null) return "Nothing selected";
    return describeSelection(state.measurements, selected === "height" ? "height" : indexOf(selected), units);
  };

  /** A refused insert or delete, or a nudge held back by a rule: shown briefly, and read out. */
  let noteTimer = 0;
  const showNote = (note: ClampNote | null, readOut = true) => {
    window.clearTimeout(noteTimer);
    noteEl.textContent = note?.message ?? "";
    noteEl.hidden = note === null;
    if (note) {
      noteTimer = window.setTimeout(() => (noteEl.hidden = true), NOTE_MS);
      if (readOut) announce(note.message);
    }
  };

  const select = (selected: RingId | "height" | null) => {
    if (selected === state.selected) return;
    emit({ selected });
    announce(describe(selected));
  };

  const hover = (hovered: RingId | Gap | null) => {
    if (sameHover(hovered, state.hovered)) return;
    emit({ hovered });
  };

  /** Rings top to bottom, by id: the order Page Up / Page Down walk, after the height line. */
  const order = (): (RingId | "height")[] => ["height", ...sortRings(state.measurements).rings.filter((r) => Number.isFinite(r.position)).map((r) => r.id)];

  const insert = (gap: Gap) => {
    const edit = insertRing(state.measurements, gap);
    showNote(edit.note);
    if (edit.id === null) return;
    emit({ measurements: edit.measurements, lastEdited: edit.id, selected: edit.id, hovered: null });
    announce(`Ring added. ${describe(edit.id)}`);
  };

  /** Delete ring `id` (asked first or not already); `next` is selected after it, if it's still there. */
  const remove = (id: RingId, next: RingId | "height" | null) => {
    const edit = deleteRing(state.measurements, id);
    showNote(edit.note);
    if (edit.measurements === state.measurements) return;
    emit({ measurements: edit.measurements, selected: next, hovered: null });
    announce(next === null ? "Ring deleted" : `Ring deleted. ${describe(next)}`);
  };

  // Nudges: each one shows at once; the 3D view and the template rebuild at most every `NUDGE_REBUILD_MS`.
  let lastRebuild = 0;
  let rebuildTimer = 0;
  const nudged = (edit: RingEdit, edited: RingId | null, readout: string) => {
    const patch = { measurements: edit.measurements, ...(edited === null ? {} : { lastEdited: edited }) };
    window.clearTimeout(rebuildTimer);
    const since = performance.now() - lastRebuild;
    if (since >= NUDGE_REBUILD_MS) {
      lastRebuild = performance.now();
      emit(patch);
    } else {
      emit(patch, true);
      rebuildTimer = window.setTimeout(() => {
        lastRebuild = performance.now();
        options.change({ measurements: state.measurements }, false);
      }, NUDGE_REBUILD_MS - since);
    }
    showNote(edit.note, false);
    announce(edit.note ? `${readout}. ${edit.note.message}` : readout);
  };

  const nudge = (key: string) => {
    const { selected, measurements: m } = state;
    // One step along the display unit's grid; the target is on the grid already, so snapping leaves it there.
    const snap = { units, snap: true };
    const vertical = key === "ArrowUp" || key === "ArrowDown";
    const step = (mm: number) => nudgeLength(mm, key === "ArrowUp" || key === "ArrowRight" ? 1 : -1, units);
    if (selected === "height") {
      if (!vertical) return;
      const edit = dragHeight(m, step(m.height), snap);
      nudged(edit, null, `Height ${tapeLength(edit.measurements.height, units)}`);
      return;
    }
    const ring = m.rings.find((r) => r.id === selected);
    if (!ring || !(m.height > 0)) return;
    if (vertical) {
      const edit = dragRing(m, ring.id, { above: step(ring.position * m.height) }, snap);
      const moved = edit.measurements.rings.find((r) => r.id === ring.id)!;
      nudged(edit, ring.id, `At ${tapeLength(moved.position * m.height, units)}`);
    } else {
      const edit = dragRing(m, ring.id, { circumference: step(ring.circumference) }, snap);
      const sized = edit.measurements.rings.find((r) => r.id === ring.id)!;
      nudged(edit, ring.id, `${tapeLength(sized.circumference, units)} around`);
    }
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
  const apply = (d: Drag, measurements: RingMeasurements, isLive: boolean) => {
    const edited = d.ring?.id ?? null;
    state = { ...state, measurements, lastEdited: edited ?? state.lastEdited };
    if (d.kind === "height" && isLive && d.fit.ok) {
      // The rings keep their fractions and circumferences, so the profile only stretches up or down.
      const k = measurements.height / d.start.height;
      fit = { ...d.fit, profile: d.fit.profile.map((p) => ({ radius: p.radius, height: p.height * k })) };
      fitKey = "";
    } else refit();
    render();
    options.change({ measurements, ...(edited === null ? {} : { lastEdited: edited }) }, isLive);
  };

  /** The pointer's place in the view, px. */
  const local = (e: PointerEvent): Point2 => {
    const box = svg.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  /** The gap (by ring ids) whose band holds `p`, if a ring can go there. */
  const gapAt = (p: Point2): Gap | null => {
    const g = shown?.gaps.find(({ band }) => p.x >= band.x1 && p.x <= band.x2 && p.y >= band.y1 && p.y <= band.y2);
    return g ? { above: idAt(g.above), below: idAt(g.below) } : null;
  };
  /** The ring (its id) a hit element belongs to. */
  const ringOf = (el: Element | null) => {
    const ring = el?.closest<SVGElement>("[data-ring]")?.dataset.ring;
    return ring === undefined ? null : idAt(Number(ring));
  };

  svg.addEventListener("pointerdown", (e) => {
    if (!shown || e.button !== 0 || drag) return;
    pointerDown = true;
    const target = e.target as Element;
    const handle = target.closest<SVGElement>("[data-handle]");
    const removeHit = target.closest<SVGElement>("[data-remove]");
    if (removeHit) {
      // The click asks (see below); keep the selection meanwhile.
      e.preventDefault();
      svg.focus();
      return;
    }
    if (!handle) {
      if (ball) return;
      const ring = target.closest("[data-select]") ? ringOf(target) : null;
      if (ring !== null) {
        select(ring);
        return;
      }
      const gap = gapAt(local(e));
      if (gap) insert(gap);
      // Empty space clears the selection.
      else select(null);
      return;
    }
    e.preventDefault();
    svg.focus();
    svg.setPointerCapture(e.pointerId);
    cancelAnimationFrame(thaw);
    const kind = handle.dataset.handle as Drag["kind"];
    const index = kind === "height" ? null : Number(handle.dataset.ring);
    const start = state.measurements;
    // A ball is measured by the first ring.
    const ring = index === null ? null : (start.rings[kind === "ball" ? 0 : index] ?? null);
    drag = { kind, index, ring, start, fit, x0: e.clientX, y0: e.clientY, scale: shown.scale, next: null };
    heldScale = shownScale;
    svg.classList.add("bp-dragging");
    // Dragging a handle selects its ring or the height line.
    if (kind === "ring" && ring) select(ring.id);
    else if (kind === "height") select("height");
    else render();
  });

  svg.addEventListener("pointermove", (e) => {
    if (!drag) {
      if (ball) return;
      const ring = ringOf(e.target as Element);
      hover(ring ?? gapAt(local(e)));
      return;
    }
    const d = drag;
    // The pointer's travel in mm: right is wider, up is higher.
    const dx = (e.clientX - d.x0) / d.scale;
    const up = (d.y0 - e.clientY) / d.scale;
    const snap = { units, snap: !e.altKey };
    const { start, ring } = d;
    const edit =
      d.kind === "height"
        ? dragHeight(start, start.height + up, snap)
        : d.kind === "ball"
          ? dragBall(start, ring!.id, ring!.circumference + 2 * Math.PI * dx, snap)
          : dragRing(start, ring!.id, { above: ring!.position * start.height + up, circumference: ring!.circumference + 2 * Math.PI * dx }, snap);
    d.next = edit.measurements;
    // One refit per animation frame, however often the pointer moves.
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (drag?.next) apply(drag, drag.next, true);
      });
    }
  });
  svg.addEventListener("pointerleave", () => {
    if (!drag && !ball) hover(null);
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
  // A pointer let go anywhere (e.g. over a dialog) is no longer down.
  window.addEventListener("pointerup", () => (pointerDown = false), true);

  // The selected ring's ×: delete it, asking first unless asking is turned off.
  svg.addEventListener("click", (e) => {
    const removeHit = (e.target as Element).closest("[data-remove]");
    const id = removeHit && ringOf(removeHit);
    const ring = rings().find((r) => r.id === id);
    if (id === null || !ring) return;
    const what = `the ring at ${tapeLength(ring.position * state.measurements.height, units)}`;
    void options.confirmDelete(what).then((ok) => {
      if (ok) remove(id, null);
    });
  });

  // Tabbing in with nothing selected selects the top ring.
  svg.addEventListener("focus", () => {
    if (pointerDown || ball || state.selected !== null) return;
    const top = order()[1];
    if (top !== undefined) select(top);
  });

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
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "+" || e.key === "=") setZoom(zoom * ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") setZoom(zoom / ZOOM_STEP);
    else if (drag || ball) return;
    else if (e.key === "Escape") {
      if (state.selected === null) return;
      select(null);
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      const list = order();
      const at = list.indexOf(state.selected ?? Number.NaN);
      const next = at < 0 ? (e.key === "PageUp" ? 0 : Math.min(1, list.length - 1)) : at + (e.key === "PageUp" ? -1 : 1);
      select(list[Math.max(0, Math.min(list.length - 1, next))]);
    } else if (e.key.startsWith("Arrow")) {
      if (state.selected === null) return;
      nudge(e.key);
    } else if (e.key === "Delete") {
      const { selected } = state;
      if (selected === null || selected === "height") return;
      // The ring below takes its place in the selection, or the one above at the bottom.
      const list = order().filter((r) => r !== "height");
      const at = list.indexOf(selected);
      remove(selected, list[at + 1] ?? list[at - 1] ?? null);
    } else return;
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

function sameHover(a: RingId | Gap | null, b: RingId | Gap | null): boolean {
  if (a === null || b === null || typeof a === "number" || typeof b === "number") return a === b;
  return a.above === b.above && a.below === b.below;
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

  // The hovered gap's band, behind the pumpkin.
  if (d.ghost) {
    const gap = d.gaps.find((g) => g.above === d.ghost!.gap.above && g.below === d.ghost!.gap.below);
    if (gap) {
      const { x1, x2, y1, y2 } = gap.band;
      out.push(el("rect", { class: "bp-gap", x: x1, y: y1, width: x2 - x1, height: y2 - y1 }));
    }
  }

  if (d.circle) out.push(el("circle", { class: "bp-profile", cx: d.circle.cx, cy: d.circle.cy, r: d.circle.r }));
  if (d.profile) {
    const { right, left, rough } = d.profile;
    const points = [...right, ...[...left].reverse()];
    out.push(el("path", { class: rough ? "bp-profile bp-profile-rough" : "bp-profile", d: `M${points.map(xy).join("L")}Z` }));
  }

  // The ring a click there would add.
  if (d.ghost) {
    const g = d.ghost;
    const ghost = el("g", { class: "bp-ghost" });
    if (g.label.leader) {
      const { x1, x2, y } = g.label.leader;
      ghost.append(el("line", { class: "bp-leader", x1, y1: y, x2, y2: y }));
    }
    ghost.append(
      el("line", { class: "bp-ghost-line", x1: g.x1, y1: g.y, x2: g.x2, y2: g.y }),
      label(g.label, "bp-ghost-label"),
      el("circle", { class: "bp-plus", cx: g.plus.x, cy: g.plus.y, r: 9 }),
      el("path", { class: "bp-plus-icon", d: crossIcon(g.plus.x, g.plus.y, 4.5, false) }),
    );
    out.push(ghost);
  }

  if (d.height) {
    const h = d.height;
    const g = el("g", { class: h.selected ? "bp-height bp-selected" : "bp-height" });
    g.append(
      el("line", { class: "bp-height-line", x1: h.x1, y1: h.y, x2: h.x2, y2: h.y }),
      label(h.label, "bp-height-label"),
      pill(h.handle),
      el("path", { class: "bp-icon", d: upDownIcon(h.handle.x, h.handle.y) }),
      hit(h.handle, { "data-handle": "height" }),
    );
    out.push(g);
  }

  // A ball has one ring, sized sideways only, and nothing to select.
  const ringHandle = d.circle ? "ball" : "ring";
  for (const r of d.rings) {
    const classes = ["bp-ring", r.selected ? "bp-selected" : "", r.hovered ? "bp-hovered" : ""].filter(Boolean).join(" ");
    const g = el("g", { class: classes, "data-ring": r.index });
    g.append(el("line", { class: "bp-ring-line", x1: r.x1, y1: r.y, x2: r.x2, y2: r.y }));
    if (r.label.leader) {
      const { x1, x2, y } = r.label.leader;
      g.append(el("line", { class: "bp-leader", x1, y1: y, x2, y2: y }));
    }
    const ringLabel = label(r.label, "bp-ring-label");
    g.append(ringLabel);
    if (!d.circle) {
      ringLabel.setAttribute("data-select", "");
      // A wider, invisible line to click.
      g.append(el("line", { class: "bp-hit-line", x1: r.x1, y1: r.y, x2: r.x2, y2: r.y, "data-select": "" }));
    }
    g.append(
      pill(r.handle),
      el("path", { class: "bp-icon", d: moveIcon(r.handle.x, r.handle.y) }),
      hit(r.handle, { "data-handle": ringHandle, "data-ring": r.index }),
    );
    if (r.remove) {
      const x = el("g", { class: "bp-remove", "data-remove": "" });
      const title = el("title", {});
      title.textContent = "Delete this ring";
      x.append(
        title,
        el("circle", { class: "bp-remove-bg", cx: r.remove.x, cy: r.remove.y, r: 10 }),
        el("path", { class: "bp-remove-icon", d: crossIcon(r.remove.x, r.remove.y, 4, true) }),
      );
      g.append(x);
    }
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

/** A + (or, turned, a ×) of half-size `k` centred on (x, y). */
function crossIcon(x: number, y: number, k: number, turned: boolean): string {
  return turned ? `M${x - k},${y - k}L${x + k},${y + k}M${x + k},${y - k}L${x - k},${y + k}` : `M${x - k},${y}H${x + k}M${x},${y - k}V${y + k}`;
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
