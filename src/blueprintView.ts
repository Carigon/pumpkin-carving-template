import type { Point2, ProfileFit, PumpkinMeasurements, Units } from "./core";
import { fromMm, tapeLength, toMm } from "./displayUnits";

/** What the Blueprint view is drawn from. Lengths in mm, sizes in px. */
export interface BlueprintInput {
  /** The measurements, or in ball (test-grid) mode the ball's (one ring at mid-height, as tall as it is wide). */
  measurements: PumpkinMeasurements;
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
   * The index in `measurements.rings` of the ring edited last, which a failed fit's banner names; none (e.g. on a
   * page load) leaves the banner generic.
   */
  blame?: number | null;
  /** The ring (its index in `measurements.rings`) or height whose handle is being dragged: its label shows the value to 0.1, as the readout. */
  readout?: number | "height" | null;
}

/** A ring's line across the pumpkin, its handle and its label by the ruler. All in px, y down. */
export interface BlueprintRing {
  /** The ring's index in `measurements.rings`. */
  index: number;
  y: number;
  /** The line's ends: `OVERHANG` px past the profile on each side. */
  x1: number;
  x2: number;
  /** The middle of the handle's pill, just past the line's right end. */
  handle: Point2;
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
  height: { y: number; x1: number; x2: number; handle: Point2; label: BlueprintLabel } | null;
  /** Why there's no fitted profile, for a banner across the top of the view; null when it fits. */
  banner: string | null;
}

/** The smallest zoom: a quarter of the size that fits. */
export const MIN_ZOOM = 0.25;
/** The ruler's x, px. */
export const RULER_X = 44;
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
    banner: null,
  };
  if (!hasHeight(measurements)) return empty;
  const drawing = { ...empty, ruler: ruler(H, scale, origin, units) };

  // Top to bottom, as they're read down the drawing.
  const valid = validRings(measurements).sort((a, b) => b.position - a.position);
  const rings = valid.map(({ index, position, radius }) => {
    const y = at(0, position * H).y;
    const x1 = origin.x - radius * scale - OVERHANG;
    const x2 = origin.x + radius * scale + OVERHANG;
    return {
      index,
      y,
      x1,
      x2,
      handle: { x: x2 + HANDLE_WIDTH / 2, y },
      label: {
        x: LABEL_X,
        y: y - 9,
        text: length(2 * Math.PI * radius, input.readout === index),
        // A ball is measured around its middle alone.
        at: input.ball ? null : `at ${length(position * H, input.readout === index)}`,
        leader: { x1: RULER_X, x2: x1, y },
      },
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

  const widestRing = Math.max(0, ...valid.map((r) => r.radius));
  const yTop = at(0, H).y;
  const hx = origin.x + widestRing * scale + OVERHANG;
  const height = {
    y: yTop,
    x1: RULER_X,
    x2: hx,
    handle: { x: hx + HANDLE_WIDTH / 2, y: yTop },
    label: { x: LABEL_X, y: yTop - 10, text: `height ${length(H, input.readout === "height")}`, at: null, leader: null },
  };

  const blamed = valid.find((r) => r.index === input.blame);
  return { ...drawing, profile, rings, height, banner: banner(fit, blamed && tapeLength(blamed.position * H, units)) };
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
      ? `No smooth pumpkin shape passes through the ring at ${blamed}. Check its height and circumference. ${later}`
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
  const widest = Math.max(
    0,
    ...validRings(measurements).map((r) => r.radius),
    ...(fit.ok ? fit.profile.map((p) => p.radius) : []),
  );
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

/** The rings that can be drawn (on the pumpkin, with a size), with their index and radius in mm. */
function validRings({ rings }: PumpkinMeasurements) {
  return rings.flatMap((r, index) =>
    Number.isFinite(r.position) && r.position > 0 && r.position < 1 && Number.isFinite(r.circumference) && r.circumference > 0
      ? [{ index, position: r.position, radius: r.circumference / (2 * Math.PI) }]
      : [],
  );
}
