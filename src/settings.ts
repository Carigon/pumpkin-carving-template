import type { Units } from "./core";
import type { Paper } from "./paper";

/** The inputs a returning carver gets back on reload. Never images or designs. */
export interface Settings {
  mode: "pumpkin" | "test-grid";
  /** Test-grid squares across. */
  cells: number;
  /** Test-grid width seen from the front, in `units`; null when empty. */
  gridWidth: number | null;
  units: Units;
  /** Lengths in `units`; null when the field was left empty. */
  measurements: {
    circumference: number | null;
    frontArc: number | null;
    depth: number | null;
    /** Where the widest circumference was taken, along the front arc from the stem. */
    circumferenceAt: number | null;
    /** Extra tape rings, in list order. */
    rings: { distance: number | null; circumference: number | null }[];
  };
  /** Width and offset in `units` (width null when empty); rotation in degrees. */
  placement: { width: number | null; verticalOffset: number; rotation: number };
  /** Depth in `units`. */
  slits: { count: number; depth: number };
  paper: Paper;
  filled: boolean;
}

/** Whatever survived validation of the stored settings. A missing value means "keep the default". */
export interface RestoredSettings {
  mode?: Settings["mode"];
  cells?: number;
  gridWidth?: number | null;
  units?: Units;
  measurements?: Partial<Settings["measurements"]>;
  placement?: Partial<Settings["placement"]>;
  slits?: Partial<Settings["slits"]>;
  paper?: Paper;
  filled?: boolean;
}

/** The part of `Storage` (e.g. `localStorage`) the settings need. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "pumpkin-template-settings";
const MAX_ROTATION = 30;
const MAX_SLITS = 24;
const MAX_CELLS = 20;
const MAX_RINGS = 20;

/** The browser's localStorage, or undefined where it can't be reached (e.g. blocked by privacy settings). */
export function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Save the settings. Only the known fields are written; failures (full or blocked storage) are ignored. */
export function saveSettings(storage: SettingsStorage | undefined, s: Settings): void {
  const { circumference, frontArc, depth, circumferenceAt, rings } = s.measurements;
  const { width, verticalOffset, rotation } = s.placement;
  const picked: Settings = {
    mode: s.mode,
    cells: s.cells,
    gridWidth: s.gridWidth,
    units: s.units,
    measurements: {
      circumference,
      frontArc,
      depth,
      circumferenceAt,
      rings: rings.map((r) => ({ distance: r.distance, circumference: r.circumference })),
    },
    placement: { width, verticalOffset, rotation },
    slits: { count: s.slits.count, depth: s.slits.depth },
    paper: s.paper,
    filled: s.filled,
  };
  try {
    storage?.setItem(KEY, JSON.stringify(picked));
  } catch {
    // Not remembering settings is fine.
  }
}

/** Read the stored settings, keeping only valid values. Missing, corrupt or unreadable data restores nothing. */
export function loadSettings(storage: SettingsStorage | undefined): RestoredSettings {
  try {
    const raw = storage?.getItem(KEY) ?? null;
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? validate(parsed) : {};
  } catch {
    return {};
  }
}

function validate(s: Record<string, unknown>): RestoredSettings {
  const units = oneOf(s.units, ["in", "cm"] as const);
  const m = record(s.measurements);
  const p = record(s.placement);
  const sl = record(s.slits);
  // Lengths only mean something in known units.
  const length = <T>(value: T) => (units ? value : undefined);

  return compact({
    mode: oneOf(s.mode, ["pumpkin", "test-grid"] as const),
    cells: integerIn(s.cells, 1, MAX_CELLS),
    gridWidth: length(emptyOr(s.gridWidth, positive)),
    units,
    measurements: group({
      circumference: length(emptyOr(m.circumference, positive)),
      frontArc: length(emptyOr(m.frontArc, positive)),
      depth: length(emptyOr(m.depth, positive)),
      circumferenceAt: length(emptyOr(m.circumferenceAt, positive)),
      rings: length(rings(m.rings)),
    }),
    placement: group({
      width: length(emptyOr(p.width, positive)),
      verticalOffset: length(finite(p.verticalOffset)),
      rotation: inRange(p.rotation, -MAX_ROTATION, MAX_ROTATION),
    }),
    slits: group({ count: integerIn(sl.count, 0, MAX_SLITS), depth: length(nonNegative(sl.depth)) }),
    paper: oneOf(s.paper, ["letter", "a4"] as const),
    filled: typeof s.filled === "boolean" ? s.filled : undefined,
  });
}

type Compact<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drop undefined entries. */
function compact<T extends Record<string, unknown>>(o: T): Compact<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Compact<T>;
}

/** Drop undefined entries; undefined if nothing is left. */
function group<T extends Record<string, unknown>>(o: T): Compact<T> | undefined {
  const c = compact(o);
  return Object.keys(c).length ? c : undefined;
}

/** The rings whose lengths are all valid (or empty); the rest are dropped. */
function rings(x: unknown): Settings["measurements"]["rings"] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.slice(0, MAX_RINGS).flatMap((r) => {
    if (!isRecord(r)) return [];
    const distance = emptyOr(r.distance, positive);
    const circumference = emptyOr(r.circumference, positive);
    return distance === undefined || circumference === undefined ? [] : [{ distance, circumference }];
  });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function record(x: unknown): Record<string, unknown> {
  return isRecord(x) ? x : {};
}

function oneOf<T extends string>(x: unknown, options: readonly T[]): T | undefined {
  return options.includes(x as T) ? (x as T) : undefined;
}

function finite(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function positive(x: unknown): number | undefined {
  const n = finite(x);
  return n !== undefined && n > 0 ? n : undefined;
}

function nonNegative(x: unknown): number | undefined {
  const n = finite(x);
  return n !== undefined && n >= 0 ? n : undefined;
}

function inRange(x: unknown, min: number, max: number): number | undefined {
  const n = finite(x);
  return n !== undefined && n >= min && n <= max ? n : undefined;
}

function integerIn(x: unknown, min: number, max: number): number | undefined {
  const n = inRange(x, min, max);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/** null (an empty field) is kept as-is; anything else must pass `check`. */
function emptyOr(x: unknown, check: (x: unknown) => number | undefined): number | null | undefined {
  return x === null ? null : check(x);
}
