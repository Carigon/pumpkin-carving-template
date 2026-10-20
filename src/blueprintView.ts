import { ringAt, type Point2, type ProfileFit, type PumpkinMeasurements, type Units } from "./core";
import { fromMm, tapeLength, toMm } from "./displayUnits";
import type { HoverTarget, Selection } from "./measureState";
import { blamedFitMessage } from "./measureWarnings";
import { canInsert, widestCircumference, type Gap, type RingId, type RingMeasurements } from "./ringEdits";

/** What the Blueprint view is drawn from. Lengths in mm, sizes in px. */
export interface BlueprintInput {
  /**
   * The measurements, each ring with its id, or in ball (test-grid) mode the ball's (one ring at mid-height, as
   * tall as it is wide).
   */
  measurements: RingMeasurements;
  /** `fitProfile(measurements)`. */
  fit: ProfileFit;
  /** Test-grid mode: the ball is drawn as a circle with one handle. */
  ball: boolean;
  /** 1 fits the pumpkin plus a margin; clamped to `MIN_ZOOM`..1. */
  zoom: number;
  /** The view's size in px. */
  size: { width: number; height: number };
  units: Units;
  /**
   * Px per mm at 1×, to hold the drawing still (e.g. while a handle is dragged, then easing to the new fit);
   * by default `fitScale` of these measurements.
   */
  fitScale?: number;
  /**
   * The ring edited last (its id), which a failed fit's banner names; none (e.g. on a page load) or a ring that
   * isn't drawn leaves the banner generic.
   */
  blame?: RingId | null;
  /** The ring (its id) or height whose handle is being dragged: its label shows the value to 0.1, as the readout. */
  readout?: RingId | "height" | null;
  /** The ring (its id) or the height line that's selected; nothing is selected on a ball. */
  selected?: Selection;
  /** The ring (its id) or the gap the pointer is over; a gap gets a ghost ring. Nothing is hovered on a ball. */
  hovered?: HoverTarget;
}

/** A ring's line across the pumpkin, its handle and its label by the ruler. All in px, y down. */
export interface BlueprintRing {
  id: RingId;
  y: number;
  /** The line's ends: `OVERHANG` px past the profile on each side. */
  x1: number;
  x2: number;
  /** The middle of the handle's pill, just past the line's right end. */
  handle: Point2;
  label: BlueprintLabel;
  selected: boolean;
  hovered: boolean;
  /** Where the selected ring's round × sits (its middle); null when it isn't selected or is the last ring. */
  remove: Point2 | null;
}

/** A gap a ring can go in: between neighbouring rings, or a ring and the height or the table. */
export interface BlueprintGap extends Gap {
  /** The tinted area shown while it's hovered: from the ring (or height) above down to the ring (or table) below. */
  area: { x1: number; x2: number; y1: number; y2: number };
}

/** The ring a hovered gap would get, at its middle: a dashed line with a + in its middle, labelled like a ring. */
export interface BlueprintGhost {
  gap: Gap;
  y: number;
  x1: number;
  x2: number;
  plus: Point2;
  label: BlueprintLabel;
}

/** A label by the ruler, with a dotted leader across to its line. */
export interface BlueprintLabel {
  /** Where the text starts (start-anchored, vertically centred). */
  x: number;
  y: number;
  /** The circumference (e.g. "32 ¾ in"), or "height 9 in". */
  text: string;
  /** The height above the table (e.g. "at 6 ½ in"), shown muted after the text; none for the height or a ball. */
  at: string | null;
  /** The dotted leader's ends, from the ruler to the line (none for the height, whose line starts at the ruler). */
  leader: { x1: number; x2: number; y: number } | null;
}

/** The ruler up the left: ticks from the table to the top of the view, labels from 0 up to the height. */
export interface BlueprintRuler {
  x: number;
  /** The table (bottom) and the top of the view. */
  y1: number;
  y2: number;
  /** Each tick runs `length` px left from the ruler. */
  ticks: { y: number; length: number; major: boolean }[];
  /** Whole display units, right-aligned at `x` left of the ticks; none with no height. */
  labels: { x: number; y: number; text: string }[];
  /** The display unit, above the top label and aligned with it; null with no height. */
  units: { x: number; y: number; text: string } | null;
}

/** What the Blueprint view draws, in px with y down. */
export interface BlueprintDrawing {
  /** The zoom actually used (clamped). */
  zoom: number;
  /** Px per mm, zoom included. */
  scale: number;
  /** Where the table meets the pumpkin's axis: the bottom middle, where zoom is anchored. */
  origin: Point2;
  ruler: BlueprintRuler;
  /** The ball in test-grid mode; null for a pumpkin or with no circumference. */
  circle: { cx: number; cy: number; r: number } | null;
  /** The pumpkin's profile on both sides, stem to base (`left` mirrors `right`); null in ball mode or with no height. */
  profile: { right: Point2[]; left: Point2[]; rough: boolean } | null;
  rings: BlueprintRing[];
  /** The height line across the top, with its handle in line with the widest ring's; null with no height or a ball. */
  height: { y: number; x1: number; x2: number; handle: Point2; label: BlueprintLabel; selected: boolean } | null;
  /** The gaps a ring can go in (those `canInsert` allows), top to bottom; none on a ball. */
  gaps: BlueprintGap[];
  /** The ring the hovered gap would get; null when no offered gap is hovered. */
  ghost: BlueprintGhost | null;
  /** Why there's no fitted profile, for a banner across the top of the view; null when it fits. */
  banner: string | null;
}

/** The smallest zoom: a quarter of the size that fits. */
export const MIN_ZOOM = 0.25;
/** The ruler's x, px. */
const RULER_X = 44;
/** How far each ring line runs past the profile, px. */
export const OVERHANG = 14;
/** A handle pill's width, px; it starts at the line's end. */
export const HANDLE_WIDTH = 28;
/** Room kept clear above the pumpkin (the view switcher, the height label) and below the table, px. */
const TOP = 56;
const BOTTOM = 40;
/** Room for a ring's label between the ruler and the pumpkin, px. */
const LABEL_WIDTH = 84;
/** Space between the label column and the ruler, px. */
const LABEL_GAP = 16;
/** Where labels start, right of the ruler, px. */
const LABEL_X = RULER_X + 8;
/** Samples down each side of the drawn profile. */
const PROFILE_SAMPLES = 129;

/**
 * The Blueprint view's geometry: the pumpkin drawn flat from the front at true scale against a ruler, with each
 * ring's line, handle and label, and the height line. Pure, so the SVG wiring only draws what this returns.
 */
export function blueprintView(input: BlueprintInput): BlueprintDrawing {
  const { measurements, units } = input;
  /** A ring's or the height's label: as read off a tape, or to 0.1 while its handle is dragged. */
  const length = (mm: number, dragged: boolean) => (dragged ? `${fromMm(mm, units).toFixed(1)} ${units}` : tapeLength(mm, units));
  const zoom = clampZoom(input.zoom);
  const scale = (input.fitScale ?? fitScale(input)) * zoom;
  const origin = { x: input.size.width / 2, y: input.size.height - BOTTOM };
  const at = (radius: number, above: number): Point2 => ({ x: origin.x + radius * scale, y: origin.y - above * scale });

  const H = measurements.height;
  const empty = {
    zoom,
    scale,
    origin,
    ruler: ruler(Number.NaN, scale, origin, units),
    circle: null,
    profile: null,
    rings: [],
    height: null,
    gaps: [],
    ghost: null,
    banner: null,
  };
  if (!hasHeight(measurements)) return empty;
  const drawing = { ...empty, ruler: ruler(H, scale, origin, units) };

  // Top to bottom, as they're read down the drawing.
  const valid = validRings(measurements).sort((a, b) => b.position - a.position);
  /** A ring's line across the pumpkin at `position` with `radius`, labelled by the ruler. */
  const line = (position: number, radius: number, dragged: boolean) => {
    const y = at(0, position * H).y;
    const x1 = origin.x - radius * scale - OVERHANG;
    const x2 = origin.x + radius * scale + OVERHANG;
    const label: BlueprintLabel = {
      x: LABEL_X,
      y: y - 9,
      text: length(2 * Math.PI * radius, dragged),
      // A ball is measured around its middle alone.
      at: input.ball ? null : `at ${length(position * H, dragged)}`,
      leader: { x1: RULER_X, x2: x1, y },
    };
    return { y, x1, x2, label };
  };
  // A ball has nothing to select, hover or insert.
  const selected = input.ball ? null : input.selected;
  const hovered = input.ball ? null : input.hovered;
  const rings = valid.map(({ id, position, radius }) => {
    const l = line(position, radius, input.readout === id);
    const isSelected = selected === id;
    return {
      id,
      ...l,
      handle: { x: l.x2 + HANDLE_WIDTH / 2, y: l.y },
      selected: isSelected,
      hovered: hovered === id,
      // The last ring can't be deleted.
      remove: isSelected && measurements.rings.length > 1 ? { x: origin.x, y: l.y } : null,
    };
  });

  if (input.ball) {
    const radius = valid[0]?.radius ?? Number.NaN;
    const circle = { cx: origin.x, cy: origin.y - radius * scale, r: radius * scale };
    return { ...drawing, circle: radius > 0 ? circle : null, rings: rings.slice(0, 1) };
  }

  const { fit } = input;
  // The fitted profile, or with no fit a rough one straight from pole to ring to ring to pole.
  const right = fit.ok
    ? Array.from({ length: PROFILE_SAMPLES }, (_, i) => {
        const p = fit.profile[Math.round((i * (fit.profile.length - 1)) / (PROFILE_SAMPLES - 1))];
        return at(p.radius, p.height + H / 2);
      })
    : [at(0, H), ...valid.map((r) => at(r.radius, r.position * H)), at(0, 0)];
  const profile = { right, left: right.map((p) => ({ x: 2 * origin.x - p.x, y: p.y })), rough: !fit.ok };

  const widestRing = widestCircumference(valid) / (2 * Math.PI);
  const yTop = at(0, H).y;
  const hx = origin.x + widestRing * scale + OVERHANG;
  const height = {
    y: yTop,
    x1: RULER_X,
    x2: hx,
    handle: { x: hx + HANDLE_WIDTH / 2, y: yTop },
    label: { x: LABEL_X, y: yTop - 10, text: `height ${length(H, input.readout === "height")}`, at: null, leader: null },
    selected: selected === "height",
  };

  // Each gap down the pumpkin wide enough for a ring, its area spanning the pumpkin at its widest.
  const widest = widestRadius(valid, fit);
  const stops = [{ id: null, position: 1 }, ...valid, { id: null, position: 0 }];
  const open = stops.slice(1).flatMap((below, i) => {
    const above = stops[i];
    return canInsert(measurements, { above: above.id, below: below.id }) ? [] : [{ above, below }];
  });
  const gaps: BlueprintGap[] = open.map(({ above, below }) => ({
    above: above.id,
    below: below.id,
    area: {
      x1: origin.x - widest * scale - OVERHANG,
      x2: origin.x + widest * scale + OVERHANG,
      y1: at(0, above.position * H).y,
      y2: at(0, below.position * H).y,
    },
  }));

  const target = hovered !== null && typeof hovered === "object" ? hovered : null;
  const hoveredGap = target && open.find((g) => g.above.id === target.above && g.below.id === target.below);
  let ghost: BlueprintGhost | null = null;
  if (hoveredGap) {
    // Where an inserted ring goes, with the circumference it gets (see `insertRing`).
    const position = (hoveredGap.above.position + hoveredGap.below.position) / 2;
    const l = line(position, ringAt(measurements, position) / (2 * Math.PI), false);
    ghost = { gap: { above: target.above, below: target.below }, ...l, plus: { x: origin.x, y: l.y } };
  }

  const blamed = valid.find((r) => r.id === input.blame);
  return {
    ...drawing,
    profile,
    rings,
    height,
    gaps,
    ghost,
    banner: banner(fit, blamed && tapeLength(blamed.position * H, units)),
  };
}

/**
 * What the banner across the top says when there's no profile: the shape-fit failure, naming the ring edited
 * last by its height above the table (`blamed`) or else as the core words it, or, when a ring isn't measured
 * properly yet (the form marks it), a pointer to the form.
 */
function banner(fit: ProfileFit, blamed: string | undefined): string | null {
  if (fit.ok) return null;
  const shape = fit.warnings.find((w) => w.field === "ring" && w.ring === undefined && w.kind === "impossible-measurement");
  const later = "(Edits still apply; a later edit may fix it.)";
  if (shape && fit.warnings.length === 1) {
    return blamed
      ? `${blamedFitMessage(`the ring at ${blamed}`)} ${later}`
      : `${shape.message} ${later}`;
  }
  return "Some rings aren't measured yet. Fix the rings marked in the form to see the shape.";
}

/** Where the ruler's labels go, right-aligned this far left of the ruler, px. */
const RULER_LABEL_X = RULER_X - 13;
/** The closest ruler labels may sit, px. */
const LABEL_SPACING = 22;

/**
 * The ruler for a pumpkin `extent` mm tall (NaN: none yet, unlabelled), at `scale` px per mm. Labels go every 1,
 * 2, 5, 10… display units, as often as fits; finer ticks (¼ in or 0.5 cm, then whole units) show when there's room.
 */
function ruler(extent: number, scale: number, origin: Point2, units: Units): BlueprintRuler {
  const perUnit = toMm(1, units) * scale;
  const labelStep = [1, 2, 5, 10, 20, 50].find((k) => k * perUnit >= LABEL_SPACING) ?? 100;
  const fine = units === "in" ? 0.25 : 0.5;
  const minor = perUnit >= 24 ? fine : perUnit >= 10 ? 1 : labelStep;
  const labelled = Number.isFinite(extent) && extent > 0;
  // Rounded up, ignoring float noise (9 in held as 228.6 mm is 9, not 10).
  const top = labelled ? Math.ceil(extent / toMm(1, units) - 1e-9) : 0;
  const ticks: BlueprintRuler["ticks"] = [];
  const labels: BlueprintRuler["labels"] = [];
  for (let i = 0; i * minor * perUnit <= origin.y + 1e-9; i++) {
    const value = i * minor;
    const y = origin.y - value * perUnit;
    const whole = Math.abs(value - Math.round(value)) < 1e-9;
    const major = whole && Math.round(value) % labelStep === 0;
    ticks.push({ y, length: major ? 10 : whole ? 6 : 3, major });
    if (labelled && major && value <= top) labels.push({ x: RULER_LABEL_X, y, text: String(Math.round(value)) });
  }
  return {
    x: RULER_X,
    y1: origin.y,
    y2: 0,
    ticks,
    labels,
    units: labelled ? { x: RULER_LABEL_X, y: origin.y - top * perUnit - 16, text: units } : null,
  };
}

/**
 * The selection as a screen reader reads it out: a ring by its height above the table, its circumference and its
 * place counting down from the top (e.g. "Ring at 6 ½ in, 32 ¾ in around, 3 of 4"), or the height ("Height 9 in").
 * Empty for a ring that can't be drawn.
 */
export function describeSelection(measurements: RingMeasurements, selected: RingId | "height", units: Units): string {
  if (selected === "height") return `Height ${tapeLength(measurements.height, units)}`;
  const rings = validRings(measurements).sort((a, b) => b.position - a.position);
  const place = rings.findIndex((r) => r.id === selected);
  if (place < 0 || !hasHeight(measurements)) return "";
  const { position, radius } = rings[place];
  const H = measurements.height;
  return `Ring at ${tapeLength(position * H, units)}, ${tapeLength(2 * Math.PI * radius, units)} around, ${place + 1} of ${rings.length}`;
}

/** `zoom` within `MIN_ZOOM`..1. */
export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(1, Math.max(MIN_ZOOM, zoom)) : 1;
}

/**
 * Px per mm at 1×: the pumpkin (its height, and its widest point with the ring lines' overhang and handles on
 * the right and the ring labels on the left) fills the view with a margin.
 */
export function fitScale(input: Pick<BlueprintInput, "measurements" | "fit" | "size" | "units">): number {
  const { measurements, fit, size } = input;
  // With no height yet, a ruler a foot (or 30 cm) tall.
  const extent = hasHeight(measurements) ? measurements.height : toMm(input.units === "in" ? 12 : 30, input.units);
  const byHeight = (size.height - TOP - BOTTOM) / extent;
  const widest = widestRadius(validRings(measurements), fit);
  // Room each side of the middle for the radius, past the overhang and handle on the right and the ruler on the
  // left. The ring labels get their own column left of the pumpkin while that leaves the pumpkin at least half
  // of it; in a narrower view they run over the pumpkin instead.
  const room = size.width / 2 - RULER_X - OVERHANG - HANDLE_WIDTH;
  const side = Math.max(room - LABEL_GAP - LABEL_WIDTH, room / 2);
  const byWidth = widest > 0 && hasHeight(measurements) ? side / widest : Infinity;
  // However small the view, something to draw at (and a ruler with a finite number of ticks).
  return Math.max(MIN_SCALE, Math.min(byHeight, byWidth)) || MIN_SCALE;
}

/** The smallest px per mm at 1× (1 m in 50 px), for a view squeezed to nothing. */
const MIN_SCALE = 0.05;

/** A height there's something to draw for. */
function hasHeight({ height }: PumpkinMeasurements): boolean {
  return Number.isFinite(height) && height > 0;
}

/** The rings that can be drawn (on the pumpkin, with a size), with their id, circumference and radius in mm. */
function validRings({ rings }: RingMeasurements) {
  return rings.flatMap((r) =>
    Number.isFinite(r.position) && r.position > 0 && r.position < 1 && Number.isFinite(r.circumference) && r.circumference > 0
      ? [{ id: r.id, position: r.position, circumference: r.circumference, radius: r.circumference / (2 * Math.PI) }]
      : [],
  );
}

/** The pumpkin's widest radius, mm: its widest drawn ring's, or the fitted profile's where that bulges further. */
function widestRadius(rings: ReturnType<typeof validRings>, fit: ProfileFit): number {
  return Math.max(widestCircumference(rings) / (2 * Math.PI), ...(fit.ok ? fit.profile.map((p) => p.radius) : []));
}
