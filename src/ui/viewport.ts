import type { Step, View } from "../steps";

/**
 * What the viewport says when there's nothing (or not everything) to draw: `empty` covers the view (e.g.
 * impossible measurements, no pumpkin to show), `note` sits over it (e.g. the pumpkin shows but no design yet).
 */
export type PlaceholderKind = "empty" | "note";

export interface Viewport {
  /** The 3D view's canvas, for the Three.js preview. */
  readonly canvas: HTMLCanvasElement;
  /** Show a small status badge over the viewport (e.g. "Updating stretch tint…"); null hides it. */
  setStatus(text: string | null): void;
  /** Show a placeholder message over the 3D view; null hides it. */
  setPlaceholder(text: string | null, kind?: PlaceholderKind): void;
  /** Entering `step`: switch to its default view. */
  enter(step: Step): void;
  /** The view showing now. */
  view(): View;
}

/**
 * The viewport pane next to the controls. It hosts one element per view (`data-view`), shows one at a time,
 * and follows the step: entering a step selects that step's default view. Today the only view is 3D; the
 * Trace and Paper views and the view switcher plug in here by adding their elements to `views`.
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
    <div class="status-badge" role="status" hidden></div>
  `;
  const views: Record<View, HTMLElement> = {
    "3d": root.querySelector<HTMLElement>('[data-view="3d"]')!,
  };
  const status = root.querySelector<HTMLElement>(".status-badge")!;
  const placeholder = root.querySelector<HTMLElement>(".view-placeholder")!;
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
    setPlaceholder(text, kind = "empty") {
      placeholder.textContent = text ?? "";
      placeholder.dataset.kind = kind;
      placeholder.hidden = text === null;
    },
    enter: (step) => show(step.defaultView),
    view: () => current,
  };
}
