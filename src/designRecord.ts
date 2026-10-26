/**
 * The record module (spec #27, ADR 0002): the loaded design and the work on it as one versioned record, the one
 * validator that reads it back, and the save rules that keep it across reloads. Pure: storage comes in through
 * `RecordStorage` (IndexedDB in the app, memory in tests).
 */
import type { HandTraceRecord, Offset, Page, Point, Shape } from "./handTrace";
import { isFrame, START_FRAME, type AspectChoice, type Cleanup, type FrameCorners, type FramePoint } from "./input/cleanupFrame";
import type { TraceSettings } from "./input/traceImage";

/** A photo as the carver chose it: the file's bytes, never pixels. */
export interface PhotoFile {
  name: string;
  /** The file's media type, e.g. "image/jpeg". */
  type: string;
  bytes: ArrayBuffer;
}

/** Auto-trace's settings as kept: all of them (what it traces is the photo as its cleanup leaves it). */
export type AutoTraceSettings = TraceSettings;

/** Auto-trace's settings before the carver moves them, and what an invalid kept one falls back to. */
export const AUTO_TRACE_DEFAULTS: AutoTraceSettings = { threshold: 128, invert: false, speckle: 2 };
/** The threshold slider's range: a grey level strictly between black and white. */
export const THRESHOLD_RANGE = { min: 1, max: 254 };
/** The most speckle removal offers, in px. */
export const MAX_SPECKLE = 1000;

/** How a photo becomes the design: auto-trace (Potrace) or hand-trace. */
export type TracingMethod = "auto" | "hand";

/**
 * Cleanup's tone, in percent (100 leaves the photo as it is): a display filter on the photo a hand-trace is placed
 * over, never on what auto-trace traces.
 */
export interface Tone {
  brightness: number;
  contrast: number;
}

/** The tone of a new photo, and what an invalid kept setting falls back to: the photo as it is. */
export const TONE_DEFAULTS: Tone = { brightness: 100, contrast: 100 };
/** The Brightness and Contrast sliders' range, in percent: from half to triple, enough to lift faint pencil. */
export const TONE_RANGE = { min: 50, max: 300 };

/** A photo and the work on it. */
export interface PhotoRecord {
  source: "photo";
  photo: PhotoFile;
  cleanup: Cleanup;
  tone: Tone;
  /** The photo is in Cleanup (new, or Straighten photo pressed): a reload comes back to it there. */
  inCleanup: boolean;
  autoTrace: AutoTraceSettings;
  /** The photo's hand-trace, in the cleaned-up photo's design space; kept whichever method is chosen. */
  handTrace: HandTraceRecord;
  /** The chosen tracing method: the design is its result. */
  method: TracingMethod;
  /** Done was pressed on the chosen method (and not Edit since). */
  done: boolean;
}

/**
 * A hand-trace on a page: a blank page, or an SVG design's after Edit as hand-trace, which keeps the file's `name`
 * (for the download's) and lands on a page shaped to the design.
 */
export interface PageRecord {
  source: "page";
  page: Page;
  handTrace: HandTraceRecord;
  name?: string;
}

/** The loaded design and the work on it, by where it came from. */
export type DesignRecord = { source: "svg"; svg: { name: string; text: string } } | PhotoRecord | PageRecord;

/** The part of IndexedDB the record needs: one slot of a few named entries, structured-cloned in and out. */
export interface RecordStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Keeps the loaded design across reloads. */
export interface RecordKeeper {
  /** The kept record, validated part by part; null when there's nothing usable to restore. */
  restore(): Promise<DesignRecord | null>;
  /**
   * Keep `record` as the loaded design's work (null: no design is loaded any more). A photo is written only when
   * it's a different photo from the last one kept or restored; the rest is written every time.
   */
  keep(record: DesignRecord | null): Promise<void>;
  /**
   * False once a save has failed (the photo didn't fit even shrunk, or storage is blocked), and from then on: this
   * browser won't keep the work after a reload.
   */
  keepsWork(): boolean;
}

/** The record format's version: a record with any other restores nothing (and a hand-trace file opens as plain shapes). */
export const RECORD_VERSION = 1;
/** The entry holding everything but the photo, and which photo it goes with. */
const WORK = "work";
/** The entry holding the photo, written once per photo since it's the big part. */
const PHOTO = "photo";

/** The photo entry: the photo and the id the work entry names it by. */
interface PhotoEntry {
  id: string;
  photo: unknown;
}

/**
 * The record keeper over `storage`. `shrink` makes the copy of a photo, shrunk to 2048 px on the long edge, that's
 * kept when the photo as chosen won't fit.
 */
export function createRecordKeeper(
  storage: RecordStorage | undefined,
  shrink: (photo: PhotoFile) => Promise<PhotoFile>,
): RecordKeeper {
  /**
   * The photo last kept or restored: its id, and what's in storage for it (the photo as chosen, its shrunk copy,
   * or null when neither fit).
   */
  let kept: { photo: PhotoFile; id: string; stored: PhotoFile | null } | null = null;
  /** A save failed: this browser won't keep the work. */
  let lost = false;
  /** Keeps run one at a time, in the order made, so an older one never lands after a newer one. */
  let queue = Promise.resolve();

  const store = async (storage: RecordStorage, record: DesignRecord | null) => {
    if (!record) {
      kept = null;
      await storage.delete(WORK);
      await storage.delete(PHOTO);
      return;
    }
    const { photo: _, ...work } = writeRecord(record);
    if (record.source !== "photo") {
      kept = null;
      await storage.set(WORK, work);
      await storage.delete(PHOTO);
      return;
    }
    if (kept?.photo !== record.photo) kept = { photo: record.photo, id: newId(), stored: record.photo };
    // A new photo, or another tab wrote its own design since: (re)write the photo, never pairing it with old work.
    if (kept.stored && !(await photoIsKept(storage, kept.id))) {
      await storage.delete(WORK);
      kept.stored = await storePhoto(storage, kept);
    }
    // Once the photo failed, work on it isn't written: without the photo it would restore nothing.
    if (kept.stored) await storage.set(WORK, { ...work, photoId: kept.id });
  };

  /** Write the photo; if it won't fit, its shrunk copy. What was written, or null when neither was. */
  const storePhoto = async (storage: RecordStorage, photo: { id: string; stored: PhotoFile | null; photo: PhotoFile }) => {
    try {
      await storage.set(PHOTO, { id: photo.id, photo: photo.stored } satisfies PhotoEntry);
      return photo.stored;
    } catch {
      try {
        const shrunk = await shrink(photo.photo);
        await storage.set(PHOTO, { id: photo.id, photo: shrunk } satisfies PhotoEntry);
        return shrunk;
      } catch {
        lost = true;
        return null;
      }
    }
  };

  return {
    async restore() {
      try {
        const work = await storage?.get(WORK);
        if (!storage || !isRecord(work)) return null;
        const entry = work.photoId === undefined ? undefined : await storage.get(PHOTO);
        const photo = isRecord(entry) && entry.id === work.photoId ? entry.photo : undefined;
        const record = readRecord({ ...work, photo });
        kept = record?.source === "photo" ? { photo: record.photo, id: work.photoId as string, stored: record.photo } : null;
        return record;
      } catch {
        return null;
      }
    },
    keep(record) {
      queue = queue.then(async () => {
        if (!storage) return void (lost = true);
        try {
          await store(storage, record);
        } catch {
          lost = true;
          // Never leave older work to come back in place of what's loaded now.
          await storage.delete(WORK).catch(() => undefined);
        }
      });
      return queue;
    },
    keepsWork: () => !lost,
  };
}

/** The kept work names photo `id`: the photo entry is that photo, unless another tab replaced it since. */
async function photoIsKept(storage: RecordStorage, id: string): Promise<boolean> {
  const work = await storage.get(WORK);
  return isRecord(work) && work.photoId === id;
}

/** An id telling one loaded photo from the next (`crypto.randomUUID` needs a secure context). */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** `record` as stored: plain data with the format's version. */
export function writeRecord(record: DesignRecord): Record<string, unknown> {
  return { version: RECORD_VERSION, ...record };
}

/** The record in `raw`, each part checked on its own; null when there's nothing usable to restore. */
export function readRecord(raw: unknown): DesignRecord | null {
  if (!isRecord(raw) || raw.version !== RECORD_VERSION) return null;
  if (raw.source === "svg") {
    const svg = isRecord(raw.svg) ? raw.svg : {};
    const readable = typeof svg.name === "string" && typeof svg.text === "string" && svg.text !== "";
    return readable ? { source: "svg", svg: { name: svg.name as string, text: svg.text as string } } : null;
  }
  if (raw.source === "photo") {
    const photo = readPhoto(raw.photo);
    return (
      photo && {
        source: "photo",
        photo,
        cleanup: readCleanup(raw.cleanup),
        tone: readTone(raw.tone),
        inCleanup: raw.inCleanup === true,
        autoTrace: readAutoTrace(raw.autoTrace),
        handTrace: readHandTrace(raw.handTrace),
        // A new photo starts on hand-trace.
        method: oneOf(raw.method, ["auto", "hand"] as const) ?? "hand",
        done: raw.done === true,
      }
    );
  }
  if (raw.source === "page") {
    const page = readPage(raw.page);
    const name = typeof raw.name === "string" ? { name: raw.name } : {};
    return page && { source: "page", page, handTrace: readHandTrace(raw.handTrace), ...name };
  }
  return null;
}

function readPhoto(x: unknown): PhotoFile | null {
  if (!isRecord(x) || typeof x.name !== "string" || typeof x.type !== "string") return null;
  if (!x.type.startsWith("image/") || !(x.bytes instanceof ArrayBuffer) || x.bytes.byteLength === 0) return null;
  return { name: x.name, type: x.type, bytes: x.bytes };
}

/** Each setting on its own: an invalid or missing one falls back to its default. */
function readAutoTrace(x: unknown): AutoTraceSettings {
  const s = isRecord(x) ? x : {};
  const d = AUTO_TRACE_DEFAULTS;
  return {
    threshold: integerIn(s.threshold, THRESHOLD_RANGE.min, THRESHOLD_RANGE.max) ?? d.threshold,
    invert: typeof s.invert === "boolean" ? s.invert : d.invert,
    speckle: integerIn(s.speckle, 0, MAX_SPECKLE) ?? d.speckle,
  };
}

/** Each tone setting on its own: an invalid or missing one leaves the photo as it is. */
function readTone(x: unknown): Tone {
  const s = isRecord(x) ? x : {};
  const percent = (v: unknown, fallback: number) => {
    const n = finite(v);
    return n !== undefined && n >= TONE_RANGE.min && n <= TONE_RANGE.max ? n : fallback;
  };
  return {
    brightness: percent(s.brightness, TONE_DEFAULTS.brightness),
    contrast: percent(s.contrast, TONE_DEFAULTS.contrast),
  };
}

/** The aspect chips a kept cleanup may name. */
const ASPECT_CHOICES: readonly AspectChoice[] = ["letter", "a4", "square", "estimated"];

/** The frame and the aspect chip, each on its own: an invalid or missing one falls back to a new photo's. */
function readCleanup(x: unknown): Cleanup {
  const c = isRecord(x) ? x : {};
  const corners = Array.isArray(c.corners) ? c.corners.map(readFramePoint) : [];
  const valid = corners.every((p) => p !== null) && isFrame(corners);
  return { corners: valid ? (corners as unknown as FrameCorners) : START_FRAME, aspect: oneOf(c.aspect, ASPECT_CHOICES) ?? null };
}

function readFramePoint(x: unknown): FramePoint | null {
  if (!isRecord(x)) return null;
  const [px, py] = [finite(x.x), finite(x.y)];
  return px === undefined || py === undefined ? null : { x: px, y: py };
}

function readPage(x: unknown): Page | null {
  if (!isRecord(x)) return null;
  const [width, height] = [positive(x.width), positive(x.height)];
  return width && height ? { width, height } : null;
}

/** A hand-trace with nothing drawn: what an invalid one restores as. */
const EMPTY_HAND_TRACE: HandTraceRecord = { shapes: [], drawing: null, done: false };

/**
 * The hand-trace in `x`: one bad shape or point makes the whole of it invalid, and it restores empty. Points aren't
 * checked against the page: imported points stay where they come, even outside it.
 */
function readHandTrace(x: unknown): HandTraceRecord {
  if (!isRecord(x) || !Array.isArray(x.shapes)) return EMPTY_HAND_TRACE;
  const shapes = x.shapes.map(readShape);
  if (!shapes.every((s) => s !== null) || new Set(shapes.map((s) => s.id)).size < shapes.length) return EMPTY_HAND_TRACE;
  const drawing = shapes.find((s) => s.id === x.drawing && !s.closed)?.id ?? null;
  return { shapes, drawing, done: x.done === true, ...(x.symmetry === true && { symmetry: true }) };
}

/**
 * The fewest points a closed shape has, as the editor closes it; a symmetric shape's half needs fewer, its
 * reflection making up the rest (two points off the axis are four in all).
 */
const MIN_CLOSED_POINTS = 3;
const MIN_SYMMETRIC_POINTS = 2;

function readShape(x: unknown): Shape | null {
  if (!isRecord(x) || !Array.isArray(x.points)) return null;
  const id = integerIn(x.id, 1, Number.MAX_SAFE_INTEGER);
  const mirror = oneOf(x.mirror, ["none", "twin", "symmetric"] as const);
  const points = x.points.map(readPoint);
  if (id === undefined || mirror === undefined || typeof x.closed !== "boolean") return null;
  const least = !x.closed ? 1 : mirror === "symmetric" ? MIN_SYMMETRIC_POINTS : MIN_CLOSED_POINTS;
  if (!points.every((p) => p !== null) || points.length < least) return null;
  return { id, closed: x.closed, mirror, points };
}

function readPoint(x: unknown): Point | null {
  if (!isRecord(x)) return null;
  const [px, py] = [finite(x.x), finite(x.y)];
  const kind = oneOf(x.kind, ["corner", "smooth"] as const);
  const [handleIn, handleOut] = [readOffset(x.in), readOffset(x.out)];
  if (px === undefined || py === undefined || !kind || handleIn === null || handleOut === null) return null;
  return { x: px, y: py, kind, ...(handleIn && { in: handleIn }), ...(handleOut && { out: handleOut }) };
}

/** A handle's offset; undefined when there's none, null when it's invalid. */
function readOffset(x: unknown): Offset | null | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) return null;
  const [ox, oy] = [finite(x.x), finite(x.y)];
  return ox === undefined || oy === undefined ? null : { x: ox, y: oy };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
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

function integerIn(x: unknown, min: number, max: number): number | undefined {
  const n = finite(x);
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}
