/**
 * The cleanup frame (spec #27): the frame's four corners and an aspect choice in; the homography that squares up
 * what's inside the frame, and the cleaned-up photo's size, out. Pure, no DOM. Research:
 * docs/research/perspective-correction.md on the `research/perspective-correction` branch.
 */
import type { Page } from "../handTrace";
import { fitWithin } from "./rasterPrep";

/** A spot on the photo as fractions of its width and height, from its top-left corner (y down). */
export interface FramePoint {
  x: number;
  y: number;
}

/**
 * The frame corners, in the order of the cleaned-up photo's top-left, top-right, bottom-right and bottom-left
 * corners: clockwise on the photo, which keeps the frame from being drawn as its own mirror image.
 */
export type FrameCorners = readonly [FramePoint, FramePoint, FramePoint, FramePoint];

/** The aspect chips: a paper size (oriented to follow the frame), or the shape the frame's corners imply. */
export type AspectChoice = "letter" | "a4" | "square" | "estimated";

/** The photo's cleanup as kept: the frame, and the aspect chip picked (null: the snapped estimate). */
export interface Cleanup {
  corners: FrameCorners;
  aspect: AspectChoice | null;
}

/** A photo's size in px. */
export interface PhotoSize {
  width: number;
  height: number;
}

/** A 3×3 projective map, row-major, from the cleaned-up photo's px to the photo's px. */
export type Homography = readonly number[];

/** The cleaned-up photo for a cleanup. */
export interface CleanedUp {
  /** Maps a spot on the cleaned-up photo (px, from its top-left) to where it is on the photo (px). */
  homography: Homography;
  /** The cleaned-up photo's size in px. */
  width: number;
  height: number;
  /** The aspect chip in effect: the one picked, or the snapped estimate. */
  aspect: AspectChoice;
}

/** The cleaned-up photo's long side at most, in px: auto-trace's limit, so tracing stays quick. */
const MAX_CLEANED_UP_SIDE = 2000;
/** The paper sizes' width over height, portrait. */
const PAPER_RATIO = { letter: 8.5 / 11, a4: 210 / 297, square: 1 } as const;
/** An estimate this close to a paper size (relative) is snapped to it: Letter and A4 are 9% apart. */
const SNAP_TOLERANCE = 0.03;
/** The focal length assumed for a phone's main camera, as on a 35 mm film camera (24–26 mm equivalent). */
const PHONE_FOCAL_35_MM = 25;
/** The diagonal of a 35 mm film frame, which a 35 mm-equivalent focal length is measured against. */
const FILM_DIAGONAL_MM = Math.hypot(36, 24);

/**
 * The cleaned-up photo for `cleanup` on a photo of `photo` px. `focal35Mm` is the camera's 35 mm-equivalent focal
 * length (from the photo's EXIF), when known; otherwise a phone's is assumed.
 */
export function cleanUp(cleanup: Cleanup, photo: PhotoSize, focal35Mm = PHONE_FOCAL_35_MM): CleanedUp {
  const quad = cleanup.corners.map((c) => ({ x: c.x * photo.width, y: c.y * photo.height }));
  const focal = (focal35Mm * Math.hypot(photo.width, photo.height)) / FILM_DIAGONAL_MM;
  const estimate = estimateAspect(quad, photo, focal);
  const aspect = cleanup.aspect ?? snapAspect(estimate);
  const ratio = aspect === "estimated" ? estimate : oriented(PAPER_RATIO[aspect], estimate);
  const { width, height } = outputSize(quad, ratio);
  const [sx, sy] = [1 / width, 1 / height];
  const h = squareToQuad(quad);
  return { homography: [h[0] * sx, h[1] * sy, h[2], h[3] * sx, h[4] * sy, h[5], h[6] * sx, h[7] * sy, h[8]], width, height, aspect };
}

/**
 * The design space a hand-trace over `cleaned` is placed in (ADR 0003): one unit across, its height in proportion,
 * so points are relative to the photo's size and a shrunk copy of the photo still lines up.
 */
export function photoPage(cleaned: PhotoSize): Page {
  return { width: 1, height: cleaned.height / cleaned.width };
}

/** JPEG markers: start of image, the APP1 segment EXIF lives in, and start of scan (the pixels; no EXIF after it). */
const [SOI, APP1, SOS] = [0xffd8, 0xffe1, 0xffda];
/** EXIF tags: the pointer to the EXIF sub-IFD, and the 35 mm-equivalent focal length (a SHORT, in mm; 0: unknown). */
const [EXIF_IFD_TAG, FOCAL_35_TAG] = [0x8769, 0xa405];

/**
 * The camera's 35 mm-equivalent focal length in mm, from a JPEG's EXIF; undefined when the file isn't a JPEG or
 * doesn't say. (The browser decodes the photo but doesn't expose its EXIF.)
 */
export function exifFocal35Mm(bytes: ArrayBuffer): number | undefined {
  try {
    const view = new DataView(bytes);
    if (view.getUint16(0) !== SOI) return undefined;
    for (let at = 2; at + 4 <= view.byteLength; ) {
      const [marker, length] = [view.getUint16(at), view.getUint16(at + 2)];
      if (marker === SOS) return undefined;
      if (marker === APP1 && view.getUint32(at + 4) === 0x45786966 /* "Exif" */) return focalInTiff(new DataView(bytes, at + 10));
      at += 2 + length;
    }
  } catch {
    // A cut-off or garbled file: a RangeError reading past its end.
  }
  return undefined;
}

/** The focal length tag in an EXIF block (a TIFF structure: byte order, then IFD0 and the EXIF sub-IFD). */
function focalInTiff(tiff: DataView): number | undefined {
  const little = tiff.getUint16(0) === 0x4949; // "II"
  const u16 = (at: number) => tiff.getUint16(at, little);
  const u32 = (at: number) => tiff.getUint32(at, little);
  /** Where the entry for `tag` is in the IFD at `ifd`. */
  const entry = (ifd: number, tag: number) => {
    for (let i = 0, n = u16(ifd); i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
    return undefined;
  };
  const pointer = entry(u32(4), EXIF_IFD_TAG);
  const focal = pointer === undefined ? undefined : entry(u32(pointer + 8), FOCAL_35_TAG);
  const mm = focal === undefined ? 0 : u16(focal + 8);
  return mm > 0 ? mm : undefined;
}

/** Where `h` takes the spot (`x`, `y`). */
export function applyHomography(h: Homography, x: number, y: number): { x: number; y: number } {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Where the frame starts on a new photo: 10% in from its corners, so each corner is easy to grab on a phone. */
export const START_FRAME: FrameCorners = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

/** The frame on the photo's edges: the whole photo, as it is. */
export const WHOLE_PHOTO: FrameCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** A frame corner stops this far (degrees) short of a straight angle, so the frame never quite turns concave. */
const MIN_TURN_DEGREES = 5;
/** A frame side stops at this fraction of the photo's short side, so a corner never lands on its neighbour. */
const MIN_SIDE = 0.05;
/** How finely a drag or a turn is walked, as a fraction of it, before the stop is found by halving. */
const WALK_STEPS = 32;
/** Halvings that find where a drag or turn stops: well under a px. */
const HALVINGS = 30;

/** The frame corner nearest `spot` within `reach` px (on a photo of `photo` px), or null when none is that near. */
export function cornerAt(corners: FrameCorners, spot: FramePoint, photo: PhotoSize, reach: number): number | null {
  const away = corners.map((c) => Math.hypot((c.x - spot.x) * photo.width, (c.y - spot.y) * photo.height));
  const nearest = away.indexOf(Math.min(...away));
  return away[nearest] <= reach ? nearest : null;
}

/**
 * The frame with corner `index` dragged toward `to` (fractions of the photo, `photo` px in size): it stays inside
 * the photo, and stops before the frame would self-cross, turn concave or lose a side.
 */
export function moveCorner(corners: FrameCorners, index: number, to: FramePoint, photo: PhotoSize): FrameCorners {
  const from = corners[index];
  const target = { x: clamp01(to.x), y: clamp01(to.y) };
  const at = (t: number) => {
    const next = [...corners] as [FramePoint, FramePoint, FramePoint, FramePoint];
    next[index] = t === 1 ? target : { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t };
    return next;
  };
  return at(walk((t) => fits(at(t), photo)));
}

/**
 * Turn: the frame turned `degrees` clockwise on the photo (`photo` px in size) about its corners' centre,
 * stopping when a corner would leave the photo. The frame as turned, and how far it turned.
 */
export function turnFrame(corners: FrameCorners, degrees: number, photo: PhotoSize): { corners: FrameCorners; degrees: number } {
  const px = corners.map((c) => ({ x: c.x * photo.width, y: c.y * photo.height }));
  const [cx, cy] = [px.reduce((s, p) => s + p.x, 0) / 4, px.reduce((s, p) => s + p.y, 0) / 4];
  const at = (t: number) => {
    const angle = (degrees * t * Math.PI) / 180;
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return px.map((p) => ({
      x: (cx + (p.x - cx) * c - (p.y - cy) * s) / photo.width,
      y: (cy + (p.x - cx) * s + (p.y - cy) * c) / photo.height,
    })) as unknown as FrameCorners;
  };
  const turned = walk((t) => at(t).every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  return { corners: at(turned), degrees: degrees * turned };
}

/**
 * How far along a change (0: none, 1: all of it) the frame goes: all the way when every step of it is `ok`, else up
 * to just before the first step that isn't. A frame that's already not `ok` (a kept one) stays as it is.
 */
function walk(ok: (t: number) => boolean): number {
  if (!ok(0)) return 0;
  let good = 0;
  for (let i = 1; i <= WALK_STEPS; i++) {
    const t = i / WALK_STEPS;
    if (ok(t)) {
      good = t;
      continue;
    }
    let bad = t;
    for (let k = 0; k < HALVINGS; k++) {
      const mid = (good + bad) / 2;
      if (ok(mid)) good = mid;
      else bad = mid;
    }
    break;
  }
  return good;
}

/**
 * The frame on a photo of `photo` px is one a corner may stop at: convex with every corner turning at least
 * `MIN_TURN_DEGREES` short of straight, and every side at least `MIN_SIDE` of the photo's short side.
 */
function fits(corners: FrameCorners, photo: PhotoSize): boolean {
  const px = corners.map((c) => ({ x: c.x * photo.width, y: c.y * photo.height }));
  const minSide = MIN_SIDE * Math.min(photo.width, photo.height);
  const minSin = Math.sin((MIN_TURN_DEGREES * Math.PI) / 180);
  return px.every((p, i) => {
    const [q, r] = [px[(i + 1) % 4], px[(i + 2) % 4]];
    const [ax, ay, bx, by] = [q.x - p.x, q.y - p.y, r.x - q.x, r.y - q.y];
    const [a, b] = [Math.hypot(ax, ay), Math.hypot(bx, by)];
    return a >= minSide && (ax * by - ay * bx) / (a * b) >= minSin;
  });
}

/**
 * `corners` make a frame: all four on the photo, clockwise from the cleaned-up photo's top-left, and convex. (A
 * drag stops a little short of where this stops being true.)
 */
export function isFrame(corners: readonly FramePoint[]): boolean {
  if (corners.length !== 4 || !corners.every((c) => c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1)) return false;
  return corners.every((p, i) => {
    const [q, r] = [corners[(i + 1) % 4], corners[(i + 2) % 4]];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) > 0;
  });
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** A photo's pixels: RGBA bytes, row by row from the top-left. */
export interface PhotoPixels extends PhotoSize {
  data: Uint8ClampedArray;
}

/**
 * The cleaned-up photo's pixels (RGBA, `width` × `height`): each one sampled from `photo` where `homography`
 * takes its centre, blending the four nearest pixels (bilinear). The photo is expected to be shrunk first to about
 * the cleaned-up photo's size, so sampling four pixels misses little.
 */
export function warpPhoto(photo: PhotoPixels, homography: Homography, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: pw, height: ph } = photo;
  const [a, b, c, d, e, f, g, h, k] = homography;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = [x + 0.5, y + 0.5];
      const w = g * u + h * v + k;
      // Pixel centres sit at half-pixels: shift so the four around the spot are at whole numbers.
      const sx = Math.min(pw - 1, Math.max(0, (a * u + b * v + c) / w - 0.5));
      const sy = Math.min(ph - 1, Math.max(0, (d * u + e * v + f) / w - 0.5));
      const [x0, y0] = [Math.floor(sx), Math.floor(sy)];
      const [x1, y1] = [Math.min(pw - 1, x0 + 1), Math.min(ph - 1, y0 + 1)];
      const [fx, fy] = [sx - x0, sy - y0];
      const [i00, i10, i01, i11] = [(y0 * pw + x0) * 4, (y0 * pw + x1) * 4, (y1 * pw + x0) * 4, (y1 * pw + x1) * 4];
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = data[i00 + ch] + (data[i10 + ch] - data[i00 + ch]) * fx;
        const bottom = data[i01 + ch] + (data[i11 + ch] - data[i01 + ch]) * fx;
        out[o + ch] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

/**
 * Rotate 90°: the cleaned-up photo turned a quarter turn clockwise, by relabelling the corners (the frame itself
 * doesn't move).
 */
export function rotateFrame([tl, tr, br, bl]: FrameCorners): FrameCorners {
  return [bl, tl, tr, br];
}

/** The paper size `estimate` (width over height) is close to, else the estimate itself. */
function snapAspect(estimate: number): AspectChoice {
  const portrait = Math.min(estimate, 1 / estimate);
  const near = (["letter", "a4", "square"] as const).find((p) => Math.abs(portrait - PAPER_RATIO[p]) <= SNAP_TOLERANCE * PAPER_RATIO[p]);
  return near ?? "estimated";
}

/** `portrait` (width over height, at most 1) turned to landscape when the frame is wider than tall. */
function oriented(portrait: number, estimate: number): number {
  return estimate > 1 ? 1 / portrait : portrait;
}

type Px = { x: number; y: number };

/**
 * The true width over height of the rectangle imaged as `quad` (px, clockwise from its top-left), seen by a
 * camera of focal length `focal` px looking at the photo's centre: Zhang and He, "Whiteboard scanning and image
 * enhancement" (2007), §3.2, eq. 20, with the focal length fixed rather than estimated (estimating it fails when
 * opposite sides look parallel, as they do for a phone tilted straight toward the sheet).
 */
function estimateAspect(quad: Px[], photo: PhotoSize, focal: number): number {
  const [cx, cy] = [photo.width / 2, photo.height / 2];
  // Zhang and He number the corners top-left, top-right, bottom-left, bottom-right.
  const [m1, m2, m4, m3] = quad.map((p): Vec3 => [p.x - cx, p.y - cy, 1]);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = sub(scale(m2, k2), m1);
  const n3 = sub(scale(m3, k3), m1);
  const f2 = focal * focal;
  const ratio = Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + f2 * n2[2] ** 2) / (n3[0] ** 2 + n3[1] ** 2 + f2 * n3[2] ** 2));
  return Number.isFinite(ratio) && ratio > 0 ? ratio : sideRatio(quad);
}

/** Width over height from the frame's sides: the fallback when the estimate can't be made. */
function sideRatio(quad: Px[]): number {
  const [top, right, bottom, left] = sides(quad);
  return (top + bottom) / (left + right) || 1;
}

/** The lengths of `quad`'s top, right, bottom and left sides. */
function sides(quad: Px[]): number[] {
  return quad.map((p, i) => Math.hypot(quad[(i + 1) % 4].x - p.x, quad[(i + 1) % 4].y - p.y));
}

/**
 * The cleaned-up photo's size for `ratio`: as big as the frame's longer sides, so no detail inside it is lost
 * (Zhang and He §3.3), capped at the cleaned-up photo's long side.
 */
function outputSize(quad: Px[], ratio: number): PhotoSize {
  const [top, right, bottom, left] = sides(quad);
  const [w, h] = [Math.max(top, bottom), Math.max(left, right)];
  return w / h >= ratio ? fitWithin(w, w / ratio, MAX_CLEANED_UP_SIDE) : fitWithin(h * ratio, h, MAX_CLEANED_UP_SIDE);
}

/**
 * The projective map from the unit square to `quad` (corners clockwise from the square's (0, 0)), in closed form:
 * Heckbert, "Fundamentals of Texture Mapping and Image Warping" (1989), §2.2.3.
 */
function squareToQuad([p0, p1, p2, p3]: Px[]): number[] {
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const [dx1, dx2, dy1, dy2] = [p1.x - p2.x, p3.x - p2.x, p1.y - p2.y, p3.y - p2.y];
  const den = dx1 * dy2 - dx2 * dy1; // 0 only when three corners are in line, which the frame never allows
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
