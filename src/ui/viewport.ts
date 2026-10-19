import type { Step, View } from "../steps";

export interface Viewport {
  /** The 3D view's canvas, for the Three.js preview. */
  readonly canvas: HTMLCanvasElement;
  /** The Trace view's element, where the trace panel puts the crop image and the traced result. */
  readonly traceView: HTMLElement;
  /** Show a short status line over the 3D view (e.g. "Stretch tint: updating…"); null hides it. */
  setStatus(text: string | null): void;
  /** Entering `step`: switch to its default view and offer its views in the switcher. */
  enter(step: Step): void;
  /**
   * The current step's views changed (e.g. an image was loaded elsewhere): offer its views in the switcher and
   * keep the view the carver picked, unless it's no longer available, when the step's default view shows.
   */
  offer(step: Step): void;
  /** The view showing now. */
  view(): View;
}

/** The switcher's label for each view, in the order the switcher lists them. */
const VIEW_LABELS: Record<View, string> = {
  "3d": "3D",
  trace: "Trace",
};

/**
 * The viewport pane next to the controls. It hosts one element per view (`data-view`), shows one at a time,
 * and follows the step: entering a step selects that step's default view, and a segmented switcher (a radio
 * group) picks any other view the step offers. To add a view: add it to `View`, `VIEW_LABELS` and the markup.
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
    <div class="view view-trace" data-view="trace"></div>
    <div class="view-switcher" role="radiogroup" aria-label="View" hidden></div>
  `;
  const views = Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>("[data-view]")].map((el) => [el.dataset.view, el]),
  ) as Record<View, HTMLElement>;
  const status = root.querySelector<HTMLElement>(".status")!;
  const switcher = root.querySelector<HTMLElement>(".view-switcher")!;
  let current: View = "3d";

  const show = (view: View) => {
    current = view;
    for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
    for (const radio of switcher.querySelectorAll<HTMLInputElement>("input")) radio.checked = radio.value === view;
  };

  /** One radio per view the step offers; hidden when there's nothing to switch between. */
  const renderSwitcher = (step: Step) => {
    const offered = (Object.keys(VIEW_LABELS) as View[]).filter((v) => step.views.includes(v));
    switcher.replaceChildren(
      ...offered.map((view) => {
        const label = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "viewport-view";
        radio.value = view;
        radio.addEventListener("change", () => radio.checked && show(view));
        label.append(radio, VIEW_LABELS[view]);
        return label;
      }),
    );
    switcher.hidden = offered.length < 2;
  };

  show(current);

  return {
    canvas: root.querySelector<HTMLCanvasElement>(".preview-canvas")!,
    traceView: views.trace,
    setStatus(text) {
      status.textContent = text ?? "";
      status.hidden = text === null;
    },
    enter(step) {
      renderSwitcher(step);
      show(step.defaultView);
    },
    offer(step) {
      renderSwitcher(step);
      show(step.views.includes(current) ? current : step.defaultView);
    },
    view: () => current,
  };
}
