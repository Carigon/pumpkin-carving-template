import type { Units } from "./core";
import type { Paper } from "./paper";
import { MAX_RINGS } from "./ringEdits";
import { STEP_IDS, stepInMode, type Mode, type StepId } from "./steps";

/** The inputs a returning carver gets back on reload. Never images or designs. Every length is in mm. */
export interface Settings {
  mode: Mode;
  /** Test-grid squares across. */
  cells: number;
  /** Test-grid width seen from the front; null when empty. */
  gridWidth: number | null;
  /** The carver's display units. */
  units: Units;
  /** Null when the field was left empty. */
  measurements: {
    height: number | null;
    /** Tape rings, in list order. `position` is a fraction of the height (0 = table, 1 = top), not a length. */
    rings: { position: number | null; circumference: number | null }[];
  };
  /** Width and offset (width null when empty); rotation in degrees. */
  placement: { width: number | null; verticalOffset: number; rotation: number };
  /** Slit count ("auto" unless the carver typed one) and max depth. */
  slits: { count: number | "auto"; maxDepth: number };
  /** Paper margin around the design; whether the PDF prints the solid cut-out edge. */
  cut: { margin: number; line: boolean };
  paper: Paper;
  filled: boolean;
  /** The step the carver was last on. */
  step: StepId;
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
  cut?: Partial<Settings["cut"]>;
  paper?: Paper;
  filled?: boolean;
  /** Always there when settings were saved: an unknown step restores to Measure. */
  step?: StepId;
}

/** The part of `Storage` (e.g. `localStorage`) the settings need. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Lengths in mm. The first key, "pumpkin-template-settings", held them in the display units; it is ignored. */
const KEY = "pumpkin-template-v2";
const MAX_ROTATION = 30;
const MAX_SLITS = 24;
const MAX_CELLS = 20;

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
  const { height, rings } = s.measurements;
  const { width, verticalOffset, rotation } = s.placement;
  const picked: Settings = {
    mode: s.mode,
    cells: s.cells,
    gridWidth: s.gridWidth,
    units: s.units,
    measurements: {
      height,
      rings: rings.map((r) => ({ position: r.position, circumference: r.circumference })),
    },
    placement: { width, verticalOffset, rotation },
    slits: { count: s.slits.count, maxDepth: s.slits.maxDepth },
    cut: { margin: s.cut.margin, line: s.cut.line },
    paper: s.paper,
    filled: s.filled,
    step: s.step,
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
  const m = record(s.measurements);
  const p = record(s.placement);
  const sl = record(s.slits);
  const c = record(s.cut);

  const mode = oneOf(s.mode, ["pumpkin", "test-grid"] as const);

  return compact({
    mode,
    cells: integerIn(s.cells, 1, MAX_CELLS),
    gridWidth: emptyOr(s.gridWidth, positive),
    units: oneOf(s.units, ["in", "cm"] as const),
    measurements: group({
      height: emptyOr(m.height, positive),
      rings: rings(m.rings),
    }),
    placement: group({
      width: emptyOr(p.width, positive),
      verticalOffset: finite(p.verticalOffset),
      rotation: inRange(p.rotation, -MAX_ROTATION, MAX_ROTATION),
    }),
    slits: group({ count: sl.count === "auto" ? ("auto" as const) : integerIn(sl.count, 0, MAX_SLITS), maxDepth: nonNegative(sl.maxDepth) }),
    cut: group({ margin: positive(c.margin), line: typeof c.line === "boolean" ? c.line : undefined }),
    paper: oneOf(s.paper, ["letter", "a4"] as const),
    filled: typeof s.filled === "boolean" ? s.filled : undefined,
    // The app starts in pumpkin mode when the saved mode is unusable.
    step: stepInMode(oneOf(s.step, STEP_IDS) ?? "measure", mode ?? "pumpkin"),
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

/** The rings whose values are all valid (or empty); the rest are dropped. None left: undefined (keep the default ring). */
function rings(x: unknown): Settings["measurements"]["rings"] | undefined {
  if (!Array.isArray(x)) return undefined;
  const valid = x.slice(0, MAX_RINGS).flatMap((r) => {
    if (!isRecord(r)) return [];
    const position = emptyOr(r.position, fraction);
    const circumference = emptyOr(r.circumference, positive);
    return position === undefined || circumference === undefined ? [] : [{ position, circumference }];
  });
  return valid.length > 0 ? valid : undefined;
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

/** Strictly between 0 and 1. */
function fraction(x: unknown): number | undefined {
  const n = finite(x);
  return n !== undefined && n > 0 && n < 1 ? n : undefined;
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
