import {
  applyHomography,
  cleanUp,
  cornerAt,
  moveCorner,
  rotateFrame,
  turnFrame,
  WHOLE_PHOTO,
  type AspectChoice,
  type CleanedUp,
  type Cleanup,
  type FramePoint,
  type PhotoSize,
} from "../input/cleanupFrame";
import { TONE_DEFAULTS, TONE_RANGE, type Tone } from "../designRecord";
import { el } from "./svg";

/** How near a press must be to a frame corner to grab it, in screen px (as the Blueprint view's handles). */
const HIT_RADIUS = 22;
/** A frame corner's drawn radius, in screen px. */
const CORNER_RADIUS = 9;
/** How far an arrow key nudges the selected frame corner, in screen px, and with Shift (as on the hand-trace canvas). */
const NUDGE_PX = 1;
const SHIFT_NUDGE_PX = 10;
/** A run of nudges ends this long after the last one if no key release ends it first, ms (as the Blueprint view's). */
const NUDGE_IDLE_MS = 600;
/** Each arrow key's direction on screen (y down). */
const ARROWS = new Map([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
]);
/** Turn's reach either way, in degrees. */
const MAX_TURN_DEGREES = 45;
/** The aspect chips, in order, with their labels. */
const ASPECT_CHIPS: [AspectChoice, string][] = [
  ["letter", "Letter"],
  ["a4", "A4"],
  ["square", "Square"],
  ["estimated", "As estimated"],
];
/** The tone sliders, in order, with their labels. */
const TONE_SLIDERS: [keyof Tone, string][] = [
  ["brightness", "Brightness"],
  ["contrast", "Contrast"],
];

export interface CleanupPanel {
  /**
   * Show `photo` (decoded, px) framed by `cleanup` and toned by `tone`; `focal35Mm` is its camera's, from its EXIF,
   * when known.
   */
  show(photo: ImageBitmap, cleanup: Cleanup, tone: Tone, focal35Mm: number | undefined): void;
  /** The cleanup as it is now. */
  cleanup(): Cleanup;
  /** The tone as it is now, live while a slider moves. */
  tone(): Tone;
  /** The cleaned-up photo the cleanup makes. */
  cleanedUp(): CleanedUp;
}

/** `tone` as a CSS filter: a display filter only, never on the pixels auto-trace traces. */
export function toneFilter(tone: Tone): string {
  return `brightness(${tone.brightness}%) contrast(${tone.contrast}%)`;
}

/**
 * Cleanup (spec #27): the photo with its frame in `figure`, its controls (Rotate 90°, Turn, the aspect chips,
 * Brightness and Contrast, Start tracing, Use whole photo, Reset) in `controls`. The frame's rules are the cleanup
 * frame's (`src/input/cleanupFrame.ts`); this only draws and dispatches. Each released change is reported through
 * `onChange`; Start tracing and Use whole photo through `onStart`. A tone slider is reported through `onTone`, live
 * while it moves and once more (`live` false) on release: tone never changes the cleaned-up photo's pixels.
 */
export function mountCleanupPanel(
  controls: HTMLElement,
  figure: HTMLElement,
  onChange: () => void,
  onStart: () => void,
  onTone: (live: boolean) => void,
): CleanupPanel {
  controls.classList.add("cleanup-controls");
  controls.innerHTML = `
    <h3>Cleanup</h3>
    <div class="hint">Drag the frame's corners onto the sheet's corners. Click one to nudge it with the arrow keys.</div>
    <div class="field">
      <label for="c-turn">Turn</label>
      <div class="input-row">
        <input id="c-turn" type="range" min="${-MAX_TURN_DEGREES}" max="${MAX_TURN_DEGREES}" step="0.5" value="0" />
        <output for="c-turn">0°</output>
        <button type="button" class="c-rotate">Rotate 90°</button>
      </div>
    </div>
    <fieldset class="field">
      <legend>Sheet</legend>
      <div class="chips">
        ${ASPECT_CHIPS.map(([value, label]) => `<label><input type="radio" name="c-aspect" value="${value}" />${label}</label>`).join("")}
      </div>
      <div class="hint">The sheet's shape once squared up: picked from the frame until you choose.</div>
    </fieldset>
    ${TONE_SLIDERS.map(
      ([name, label]) => `
    <div class="field">
      <label for="c-${name}">${label}</label>
      <div class="input-row">
        <input id="c-${name}" type="range" min="${TONE_RANGE.min}" max="${TONE_RANGE.max}" step="5" value="${TONE_DEFAULTS[name]}" />
        <output for="c-${name}">${TONE_DEFAULTS[name]}%</output>
      </div>
    </div>`,
    ).join("")}
    <div class="hint">Brightness and Contrast help faint lines show while you hand-trace; auto-trace sees the photo as it is.</div>
    <div class="cleanup-actions">
      <button type="button" class="c-start primary">Start tracing</button>
      <button type="button" class="c-whole">Use whole photo</button>
      <button type="button" class="c-reset">Reset</button>
    </div>
  `;
  figure.innerHTML = `
    <div class="trace-fit"><div class="cleanup-stack">
      <canvas class="cleanup-photo" aria-label="The photo, with the frame to drag onto the sheet"></canvas>
      <svg class="cleanup-overlay" tabindex="0" aria-label="The frame: drag its corners onto the sheet's corners, or click one and nudge it with the arrow keys (Shift for 10 times as far)."></svg>
    </div></div>
    <figcaption>The photo: drag the frame's corners onto the sheet's corners.</figcaption>
  `;
  const $ = <T extends Element>(root: Element, sel: string) => root.querySelector<T>(sel)!;
  const stack = $<HTMLElement>(figure, ".cleanup-stack");
  const canvas = $<HTMLCanvasElement>(figure, "canvas");
  const overlay = $<SVGSVGElement>(figure, "svg");
  const turn = $<HTMLInputElement>(controls, "#c-turn");
  const turnOut = $<HTMLOutputElement>(controls, "output");
  const chips = [...controls.querySelectorAll<HTMLInputElement>('input[name="c-aspect"]')];

  let photo: PhotoSize = { width: 1, height: 1 };
  let cleanup: Cleanup = { corners: WHOLE_PHOTO, aspect: null };
  let tone: Tone = TONE_DEFAULTS;
  let focal: number | undefined;
  const toneInputs = TONE_SLIDERS.map(([name]) => {
    const input = $<HTMLInputElement>(controls, `#c-${name}`);
    const out = $<HTMLOutputElement>(controls, `output[for="c-${name}"]`);
    const show = () => {
      input.value = String(tone[name]);
      out.value = `${tone[name]}%`;
    };
    input.addEventListener("input", () => {
      tone = { ...tone, [name]: Number(input.value) };
      show();
      onTone(true);
    });
    input.addEventListener("change", () => onTone(false));
    return show;
  });
  /** The frame as Turn found it: Turn turns from here until another change. */
  let turnedFrom: Cleanup["corners"] | null = null;

  const cleanedUp = () => cleanUp(cleanup, photo, focal);
  /** A finished change of any kind but Turn: Turn starts again from the frame as it now is. */
  const changed = () => {
    turnedFrom = null;
    turn.value = "0";
    turnOut.value = "0°";
    draw();
    onChange();
  };

  /** The overlay's px per screen px: it's drawn in the photo's px. */
  const pxPerScreen = () => photo.width / (overlay.getBoundingClientRect().width || photo.width);

  function draw(): void {
    const { width: w, height: h } = photo;
    const corners = cleanup.corners.map((c) => ({ x: c.x * w, y: c.y * h }));
    const cleaned = cleanedUp();
    const top = applyHomography(cleaned.homography, cleaned.width / 2, 0);
    const bottom = applyHomography(cleaned.homography, cleaned.width / 2, cleaned.height);
    const k = pxPerScreen();
    const ring = corners.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ") + " Z";
    overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
    overlay.replaceChildren(
      el("path", { class: "cleanup-outside", d: `M0 0 H${w} V${h} H0 Z ${ring}`, "fill-rule": "evenodd" }),
      el("path", { class: "cleanup-frame", d: ring }),
      // The cleaned-up photo's top edge, drawn heavier: which way is up after Rotate 90°.
      el("line", { class: "cleanup-top", x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y }),
      el("line", { class: "symmetry-axis", x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y }),
      ...corners.map((p, i) => {
        const cls = i === selected ? "cleanup-corner selected" : "cleanup-corner";
        return el("circle", { class: cls, cx: p.x, cy: p.y, r: CORNER_RADIUS * k });
      }),
    );
    for (const chip of chips) chip.checked = chip.value === cleaned.aspect;
  }

  // Drag a frame corner; the frame follows live, and the change is reported on release. A click (or the start of a
  // drag) selects it for the arrow keys; a press elsewhere selects none.
  let dragging: number | null = null;
  let selected: number | null = null;
  const spotOf = (e: PointerEvent): FramePoint => {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  overlay.addEventListener("pointerdown", (e) => {
    overlay.focus({ preventScroll: true });
    endNudges();
    dragging = cornerAt(cleanup.corners, spotOf(e), photo, HIT_RADIUS * pxPerScreen());
    selected = dragging;
    draw();
    if (dragging === null) return;
    overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  overlay.addEventListener("pointermove", (e) => {
    if (dragging === null) return;
    cleanup = { ...cleanup, corners: moveCorner(cleanup.corners, dragging, spotOf(e), photo) };
    draw();
  });
  const release = () => {
    if (dragging === null) return;
    dragging = null;
    changed();
  };
  overlay.addEventListener("pointerup", release);
  overlay.addEventListener("pointercancel", release);

  // Arrow keys nudge the selected corner while the frame has focus. The frame follows each nudge; a run of them is
  // one released change: on the key's release, or after `NUDGE_IDLE_MS` if the release never comes here.
  let nudging = false;
  let nudgeIdle = 0;
  function endNudges(): void {
    window.clearTimeout(nudgeIdle);
    if (!nudging) return;
    nudging = false;
    changed();
  }
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected !== null) {
      selected = null;
      draw();
      return e.preventDefault();
    }
    const arrow = ARROWS.get(e.key);
    if (!arrow || selected === null || dragging !== null) return;
    e.preventDefault();
    const r = overlay.getBoundingClientRect();
    const step = e.shiftKey ? SHIFT_NUDGE_PX : NUDGE_PX;
    const at = cleanup.corners[selected];
    const to = { x: at.x + (arrow.x * step) / (r.width || 1), y: at.y + (arrow.y * step) / (r.height || 1) };
    cleanup = { ...cleanup, corners: moveCorner(cleanup.corners, selected, to, photo) };
    nudging = true;
    draw();
    window.clearTimeout(nudgeIdle);
    nudgeIdle = window.setTimeout(endNudges, NUDGE_IDLE_MS);
  });
  overlay.addEventListener("keyup", (e) => {
    if (ARROWS.has(e.key)) endNudges();
  });
  overlay.addEventListener("blur", endNudges);
  new ResizeObserver(draw).observe(overlay);

  turn.addEventListener("input", () => {
    turnedFrom ??= cleanup.corners;
    const turned = turnFrame(turnedFrom, Number(turn.value), photo);
    cleanup = { ...cleanup, corners: turned.corners };
    turnOut.value = `${Math.round(turned.degrees * 2) / 2}°`;
    draw();
  });
  turn.addEventListener("change", () => {
    if (!turnedFrom) return;
    // Show how far it turned when a corner stopped it.
    turn.value = turnOut.value.replace("°", "");
    draw();
    onChange();
  });
  for (const chip of chips)
    chip.addEventListener("change", () => {
      cleanup = { ...cleanup, aspect: chip.value as AspectChoice };
      changed();
    });
  $<HTMLButtonElement>(controls, ".c-rotate").addEventListener("click", () => {
    cleanup = { ...cleanup, corners: rotateFrame(cleanup.corners) };
    changed();
  });
  $<HTMLButtonElement>(controls, ".c-reset").addEventListener("click", () => {
    cleanup = { corners: WHOLE_PHOTO, aspect: null };
    changed();
  });
  $<HTMLButtonElement>(controls, ".c-whole").addEventListener("click", () => {
    // The whole photo as it is: its own shape, not the paper size it's nearest.
    cleanup = { corners: WHOLE_PHOTO, aspect: "estimated" };
    changed();
    onStart();
  });
  $<HTMLButtonElement>(controls, ".c-start").addEventListener("click", onStart);

  return {
    show(bitmap, next, nextTone, focal35Mm) {
      window.clearTimeout(nudgeIdle);
      nudging = false;
      selected = null;
      photo = { width: bitmap.width, height: bitmap.height };
      cleanup = next;
      tone = nextTone;
      for (const show of toneInputs) show();
      focal = focal35Mm;
      turnedFrom = null;
      turn.value = "0";
      turnOut.value = "0°";
      const scale = Math.min(1, 1200 / Math.max(photo.width, photo.height));
      canvas.width = Math.max(1, Math.round(photo.width * scale));
      canvas.height = Math.max(1, Math.round(photo.height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      stack.style.setProperty("--aspect", String(photo.width / photo.height));
      draw();
    },
    cleanup: () => cleanup,
    tone: () => tone,
    cleanedUp,
  };
}
