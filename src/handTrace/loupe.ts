import type { ScreenRect } from "./editor";
import type { ScreenPoint } from "./gestures";

/** The loupe's width across (px), and how many times it magnifies the canvas as drawn (so over the current zoom). */
const LOUPE_PX = 130;
const LOUPE_MAGNIFICATION = 3;
/** The gap (px) between the finger and the loupe, about a fingertip, so the finger never hides it. */
const LOUPE_GAP_PX = 56;
/** The loupe stays this far (px) inside the canvas's edges. */
const LOUPE_MARGIN_PX = 4;

/**
 * The loupe: a circle `box` wide, clear of the finger, showing the canvas as drawn magnified `magnification` times
 * about `focus`, where the point under the finger will land (its crosshair).
 */
export interface Loupe {
  box: ScreenRect;
  focus: ScreenPoint;
  magnification: number;
}

/**
 * The loupe for a finger at `finger` aiming at `focus`, on a canvas `width` px across: above the finger, or beside
 * it (on whichever side there's room) when there's no room above, and kept inside the canvas. The canvas's and
 * Cleanup's frame corners' alike.
 */
export function placeLoupe(finger: ScreenPoint, focus: ScreenPoint, width: number): Loupe {
  let x = finger.x - LOUPE_PX / 2;
  let y = finger.y - LOUPE_GAP_PX - LOUPE_PX;
  if (y < LOUPE_MARGIN_PX) {
    y = Math.max(LOUPE_MARGIN_PX, finger.y - LOUPE_PX / 2);
    const right = finger.x + LOUPE_GAP_PX;
    x = right + LOUPE_PX <= width - LOUPE_MARGIN_PX ? right : finger.x - LOUPE_GAP_PX - LOUPE_PX;
  }
  x = Math.min(width - LOUPE_MARGIN_PX - LOUPE_PX, Math.max(LOUPE_MARGIN_PX, x));
  return { box: { x, y, width: LOUPE_PX, height: LOUPE_PX }, focus, magnification: LOUPE_MAGNIFICATION };
}
