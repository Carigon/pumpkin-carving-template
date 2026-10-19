import type { Step, View } from "../steps";

/**
 * What the viewport says when there's nothing (or not everything) to draw: `empty` covers the view (e.g.
 * impossible measurements, no pumpkin to show), `note` sits over it (e.g. the pumpkin shows but no design yet).
 */
export type PlaceholderKind = "empty" | "note";

export interface Viewport {
  /** The 3D view's canvas, for the Three.js preview. */
  readonly canvas: HTMLCanvasElement;
  /** The Trace view's element, where the trace panel puts the crop image and the traced result. */
  readonly traceView: HTMLElement;
  /** The Paper view's element, where the flat template is drawn on its pages. */
  readonly paperView: HTMLElement;
  /** Show a small status badge over the viewport (e.g. "Updating stretch tint…"); null hides it. */
  setStatus(text: string | null): void;
  /** Show a placeholder message over the 3D view; null hides it. */
  setPlaceholder(text: string | null, kind?: PlaceholderKind): void;
  /** Entering `step`: switch to its default view and offer its views in the switcher. */
  enter(step: Step): void;
  /**
   * The current step's views changed (e.g. an image was loaded elsewhere): offer its views in the switcher and
   * keep the view the carver picked, unless it's no longer available, when the step's default view shows.
   */
  offer(step: Step): void;
}

/** The switcher's label for each view, in the order the switcher lists them. */
const VIEW_LABELS: Record<View, string> = {
  "3d": "3D",
  trace: "Trace",
  paper: "Paper",
};

/**
 * The viewport pane next to the controls. It hosts one element per view (`data-view`), shows one at a time,
 * and follows the step: entering a step selects that step's default view, and a segmented switcher (a radio
 * group) picks any other view the step offers. To add a view: add it to `View`, `VIEW_LABELS` and the markup.
 *
 * The 3D view carries a compact color legend (with the detail behind a "more" disclosure) and a placeholder
 * for when there's nothing to draw. The status badge sits over the whole pane, whichever view shows.
 */
export function mountViewport(root: HTMLElement): Viewport {
  root.classList.add("viewport");
  root.setAttribute("aria-label", "Preview");
  root.innerHTML = `
    <div class="view view-3d" data-view="3d">
      <canvas class="preview-canvas" aria-label="3D preview of the design on the pumpkin. Drag to orbit, scroll to zoom."></canvas>
      <div class="view-placeholder" hidden></div>
      <details class="legend">
        <summary>
          <span class="legend-items">
            <span class="legend-item"><span class="swatch swatch-line"></span>Design</span>
            <span class="legend-item"><span class="swatch swatch-gold"></span>Past 60°</span>
            <span class="legend-item"><span class="swatch swatch-dot"></span>Misses pumpkin</span>
            <span class="legend-item"><span class="swatch swatch-stretch"></span>Stretch</span>
          </span>
          <span class="legend-more">more</span>
        </summary>
        <ul class="legend-detail">
          <li>Gold: the design is past about 60° from the front, where the template is hard to follow.</li>
          <li>Red dots: design points outside the pumpkin's outline seen from the front; they have nowhere to land.</li>
          <li>Crimson tint: where the paper has to stretch or squeeze to lie on the pumpkin (faint from about 3 %,
            solid from 15 %). Lines there won't land exactly. A smaller design or more, deeper slits reduce it.</li>
          <li>Drag to orbit, scroll to zoom.</li>
        </ul>
      </details>
    </div>
    <div class="view view-trace" data-view="trace"></div>
    <div class="view view-paper" data-view="paper"></div>
    <div class="view-switcher" role="radiogroup" aria-label="View" hidden></div>
    <div class="status-badge" role="status" hidden></div>
  `;
  const views = Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>("[data-view]")].map((el) => [el.dataset.view, el]),
  ) as Record<View, HTMLElement>;
  const status = root.querySelector<HTMLElement>(".status-badge")!;
  const placeholder = root.querySelector<HTMLElement>(".view-placeholder")!;
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
    paperView: views.paper,
    setStatus(text) {
      status.textContent = text ?? "";
      status.hidden = text === null;
    },
    setPlaceholder(text, kind = "empty") {
      placeholder.textContent = text ?? "";
      placeholder.dataset.kind = kind;
      placeholder.hidden = text === null;
    },
    enter(step) {
      renderSwitcher(step);
      show(step.defaultView);
    },
    offer(step) {
      renderSwitcher(step);
      show(step.views.includes(current) ? current : step.defaultView);
    },
  };
}
