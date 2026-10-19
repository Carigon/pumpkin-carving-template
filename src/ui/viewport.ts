import type { Step, View } from "../steps";

export interface Viewport {
  /** The 3D view's canvas, for the Three.js preview. */
  readonly canvas: HTMLCanvasElement;
  /** Show a short status line over the 3D view (e.g. "Stretch tint: updating…"); null hides it. */
  setStatus(text: string | null): void;
  /** Entering `step`: switch to its default view. */
  enter(step: Step): void;
  /** The view showing now. */
  view(): View;
}

/**
 * The viewport pane next to the controls. It hosts one element per view (`data-view`), shows one at a time,
 * and follows the step: entering a step selects that step's default view. Today the only view is 3D; the
 * Trace and Paper views and the view switcher plug in here by adding their elements to `views`.
 */
export function mountViewport(root: HTMLElement): Viewport {
  root.classList.add("viewport");
  root.setAttribute("aria-label", "Preview");
  root.innerHTML = `
    <div class="view view-3d" data-view="3d">
      <canvas class="preview-canvas" aria-label="3D preview of the design on the pumpkin. Drag to orbit."></canvas>
      <div class="view-notes">
        <small class="hint">Drag to orbit, scroll to zoom. Dark lines: design. Gold: past about 60° from the front.
          Red dots: points that miss the pumpkin. Crimson tint: where the paper has to stretch or squeeze to lie on
          the pumpkin (faint from about 3 %, solid from 15 %); lines there won't land exactly. Smaller designs or
          more, deeper slits reduce it.</small>
        <small class="hint status" aria-live="polite" hidden></small>
      </div>
    </div>
  `;
  const views: Record<View, HTMLElement> = {
    "3d": root.querySelector<HTMLElement>('[data-view="3d"]')!,
  };
  const status = root.querySelector<HTMLElement>(".status")!;
  let current: View = "3d";

  const show = (view: View) => {
    current = view;
    for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  };
  show(current);

  return {
    canvas: root.querySelector<HTMLCanvasElement>(".preview-canvas")!,
    setStatus(text) {
      status.textContent = text ?? "";
      status.hidden = text === null;
    },
    enter: (step) => show(step.defaultView),
    view: () => current,
  };
}
