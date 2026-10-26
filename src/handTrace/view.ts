import type { ScreenPoint } from "./gestures";
import type { Page } from "./model";

/** How the page sits on screen: `screen = (tx + x·scale, ty − y·scale)` for a design-space point (y up). */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** The share of the canvas the fitted page fills, leaving a margin round it for the overlay buttons. */
const FIT_SHARE = 0.94;
/** Zoom limits, as multiples of the fitted scale. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 25;
/** How much one wheel notch (100 px of deltaY) zooms: about 14 %, as in the Blueprint view. */
const WHEEL_RATE = 0.0015;

/** The page fitted and centred in a `width` × `height` canvas. */
export function fitView(page: Page, width: number, height: number): ViewTransform {
  const scale = fitScale(page, width, height);
  return { scale, tx: (width - page.width * scale) / 2, ty: (height + page.height * scale) / 2 };
}

/** `view` zoomed by a wheel turn of `deltaY` about the screen point `at`, which stays put. */
export function wheelZoom(view: ViewTransform, fit: number, at: ScreenPoint, deltaY: number): ViewTransform {
  const scale = Math.min(fit * MAX_ZOOM, Math.max(fit * MIN_ZOOM, view.scale * Math.exp(-deltaY * WHEEL_RATE)));
  const k = scale / view.scale;
  return { scale, tx: at.x - (at.x - view.tx) * k, ty: at.y - (at.y - view.ty) * k };
}

/** The fitted scale, for the zoom limits. */
export function fitScale(page: Page, width: number, height: number): number {
  return Math.max(1e-9, Math.min(width / page.width, height / page.height) * FIT_SHARE);
}

/** Where design-space point `p` is drawn. */
export function toScreen(view: ViewTransform, p: { x: number; y: number }): ScreenPoint {
  return { x: view.tx + p.x * view.scale, y: view.ty - p.y * view.scale };
}

/** The design-space point drawn at screen point `s`. */
export function toDesignSpace(view: ViewTransform, s: ScreenPoint): { x: number; y: number } {
  return { x: (s.x - view.tx) / view.scale, y: (view.ty - s.y) / view.scale };
}
