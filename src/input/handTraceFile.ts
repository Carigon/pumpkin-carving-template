/**
 * The hand-trace file (ADR 0005): an ordinary SVG of a hand-trace's closed shapes that carries the hand-trace's
 * record, so it reopens here as an editable hand-trace while other programs see carved size and one shape with
 * holes. Reading needs the DOM (`readSvgDesign`); writing is plain text.
 */
import { distanceToSegment, type BBox, type Design, type Point2 } from "../core";
import { readRecord, RECORD_VERSION, writeRecord, type DesignRecord, type PhotoFile, type PhotoRecord } from "../designRecord";
import type { Page } from "../handTrace";
import { isRecord } from "../validate";
import { flattenPathData, roughExtent } from "./flattenPath";
import { RELATIVE_TOLERANCE } from "./pathDesign";
import { readSvgDesign, RECORD_ELEMENT, RECORD_NAMESPACE } from "./svgDesign";
import { svgShapes } from "./svgHandTrace";

/**
 * The record a hand-trace file carries: a blank page's, or a photo's with the photo as the file should carry it (a
 * JPEG shrunk to 2048 px on the long edge, or as chosen when already smaller: the caller shrinks it).
 */
type FileRecord = Exclude<DesignRecord, { source: "svg" }>;

/** What a hand-trace file is written from. */
export interface HandTraceFileContent {
  record: FileRecord;
  /** The blank page or cleaned-up photo the hand-trace is on: the file's `viewBox` while nothing is closed. */
  page: Page;
  /** The closed shapes as SVG path data (y down), as the editor makes the `Design` from it. */
  pathData: string;
  /** The hand-trace's `Design` (its box, widened about the symmetry axis, is the file's `viewBox`); null with none. */
  design: Design | null;
  /** The placed front-view Width in mm: the file's carved size. */
  width: number;
}

/** What loading an SVG file gives: a hand-trace to reopen, or an SVG design with notes saying why it isn't one. */
export type OpenedSvg =
  | { kind: "hand-trace"; record: FileRecord }
  | { kind: "svg"; design: Design | null; notes: string[] };

/** The note for a hand-trace file whose drawing no longer matches its record. */
const CHANGED = "This file was changed in another program, so it opens as plain shapes, not as an editable hand-trace.";
/** The note for a hand-trace file from a version of the record this one can't read. */
const UNKNOWN_VERSION =
  "This file's hand-trace was saved by another version of this app, so it opens as plain shapes, not as an editable hand-trace.";
/** The note for a hand-trace file whose record fails validation. */
const INVALID = "This file's hand-trace can't be read, so it opens as plain shapes, not as an editable hand-trace.";

/**
 * The hand-trace file for `content`: one compound `<path>` of the closed shapes, filled even-odd, and the record
 * (with a fingerprint of that drawing, and no placement) in a namespaced `<metadata>` element.
 */
export function writeHandTraceFile({ record, page, pathData, design, width }: HandTraceFileContent): string {
  const box: BBox = design?.bbox ?? { minX: 0, minY: 0, maxX: page.width, maxY: page.height };
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY];
  const photo = record.source === "photo" ? { photo: writePhoto(record.photo) } : {};
  const json = JSON.stringify({ ...writeRecord(record), ...photo, fingerprint: pathData });
  const path = pathData ? `\n  <path d="${pathData}" fill="black" fill-rule="evenodd"/>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}mm" height="${num((width * h) / w)}mm" ` +
    `viewBox="${[box.minX, -box.maxY, w, h].map(designUnits).join(" ")}">\n` +
    `  <metadata><${RECORD_ELEMENT} xmlns="${RECORD_NAMESPACE}">${escapeXml(json)}</${RECORD_ELEMENT}></metadata>` +
    `${path}\n</svg>\n`
  );
}

/**
 * A hand-trace file's name: `<name>-hand-trace.svg` for one traced from the file named `name` (its extension and any
 * `-hand-trace` suffix dropped first, so a reopened file downloads under the same name); a blank page's, with no
 * `name`, `hand-trace-<YYYY-MM-DD>.svg` for the local day `date` falls on.
 */
export function handTraceFileName(date: Date, name?: string): string {
  if (name !== undefined) return `${name.replace(/\.[^.]*$/, "").replace(/-hand-trace$/, "")}-hand-trace.svg`;
  const two = (n: number) => String(n).padStart(2, "0");
  return `hand-trace-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}.svg`;
}

/**
 * Read an SVG file: a hand-trace file whose drawing still matches its record's fingerprint, as geometry within the
 * loader's tolerance, reopens as a hand-trace; anything else is an SVG design, with a note when it carries a record
 * that's stale, from an unknown version or invalid.
 */
export function readHandTraceFile(text: string): OpenedSvg {
  return readFile(text).opened;
}

/**
 * Edit as hand-trace on a hand-trace file changed in another program: the shapes its visible path draws now, all
 * closed with `mirror: "none"` (a former symmetric shape whole, twins as two), back over the stale record's photo
 * with its cleanup, tone, auto-trace side and method, on the canvas and not Done. The file is drawn in that photo's
 * design space, so nothing moves; the record's own shapes, open ones included, aren't taken. Null when the file
 * isn't a changed photo hand-trace with a readable record: it then converts onto a page as any SVG design does.
 */
export function editOnStalePhoto(text: string): PhotoRecord | null {
  const { stale } = readFile(text);
  if (stale?.source !== "photo") return null;
  // The file's user space is design space with y down.
  const shapes = svgShapes(text, ({ x, y }) => ({ x, y: -y }));
  return { ...stale, inCleanup: false, done: false, handTrace: { shapes, drawing: null, done: false } };
}

/** What `readHandTraceFile` opens `text` as, and the record it carries when that's stale (its drawing changed). */
function readFile(text: string): { opened: OpenedSvg; stale?: FileRecord } {
  const svg = readSvgDesign(text);
  const plain = (note?: string): OpenedSvg => ({ kind: "svg", design: svg.design, notes: note ? [...svg.notes, note] : svg.notes });
  if (svg.record === null) return { opened: plain() };
  const raw = parseJson(svg.record);
  if (!isRecord(raw)) return { opened: plain(INVALID) };
  if (raw.version !== RECORD_VERSION) return { opened: plain(UNKNOWN_VERSION) };
  const record = readRecord({ ...raw, photo: readPhoto(raw.photo) });
  if (!record || record.source === "svg" || typeof raw.fingerprint !== "string" || emptied(raw, record)) {
    return { opened: plain(INVALID) };
  }
  if (draws(svg.design, raw.fingerprint)) return { opened: { kind: "hand-trace", record } };
  return { opened: plain(CHANGED), stale: record };
}

/** How many bytes go to `String.fromCharCode` at a time: one call with a whole photo's would overflow the stack. */
const BASE64_CHUNK = 0x8000;

/** A photo as a file's record holds it: plain JSON, its bytes in base64. */
function writePhoto({ name, type, bytes }: PhotoFile): { name: string; type: string; base64: string } {
  const all = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < all.length; i += BASE64_CHUNK) binary += String.fromCharCode(...all.subarray(i, i + BASE64_CHUNK));
  return { name, type, base64: btoa(binary) };
}

/** The photo in a file's record with its bytes back as the record module reads them; anything else as it is. */
function readPhoto(x: unknown): unknown {
  if (!isRecord(x) || typeof x.base64 !== "string") return x;
  const { base64, ...photo } = x;
  try {
    return { ...photo, bytes: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer };
  } catch {
    return undefined; // not base64: no readable photo
  }
}

/** The validator emptied the hand-trace (it restores an invalid one empty): the file's record is invalid. */
function emptied(raw: Record<string, unknown>, record: FileRecord): boolean {
  const shapes = isRecord(raw.handTrace) ? raw.handTrace.shapes : undefined;
  return !Array.isArray(shapes) || shapes.length !== record.handTrace.shapes.length;
}

/** `design` (as the loader read the file) is the geometry `fingerprint` draws, within the loader's tolerance. */
function draws(design: Design | null, fingerprint: string): boolean {
  if (!fingerprint.trim()) return design === null;
  const extent = roughExtent(fingerprint, "");
  const tolerance = RELATIVE_TOLERANCE * Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 1e-9);
  const expected = flattenPathData(fingerprint, "", tolerance).map((p) => p.map(({ x, y }) => ({ x, y: -y })));
  const actual = [...(design?.paths ?? [])];
  if (actual.length !== expected.length) return false;
  return expected.every((want) => {
    const i = actual.findIndex((got) => near(got, want, tolerance) && near(want, got, tolerance));
    return i >= 0 && actual.splice(i, 1).length === 1;
  });
}

/** Every vertex of closed polyline `a` lies within `tolerance` of closed polyline `b`. */
function near(a: readonly Point2[], b: readonly Point2[], tolerance: number): boolean {
  const [boxA, boxB] = [boxOf(a), boxOf(b)];
  if (boxA.some((v, i) => Math.abs(v - boxB[i]) > tolerance)) return false;
  return a.every((p) => b.some((q, i) => distanceToSegment(p, q, b[(i + 1) % b.length]) <= tolerance));
}

/** A polyline's box as [minX, minY, maxX, maxY]. */
function boxOf(path: readonly Point2[]): number[] {
  const [xs, ys] = [path.map((p) => p.x), path.map((p) => p.y)];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Text safe inside an XML element. */
function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A `viewBox` number in design units: rounding noise dropped, far finer than the path data's 6 digits. */
function designUnits(v: number): string {
  return String(Number(v.toPrecision(12)));
}

/** A length in mm for an attribute: a few decimals, no trailing zeros. */
function num(v: number): string {
  return String(Number(v.toFixed(3)));
}
