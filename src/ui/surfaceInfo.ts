import type { SurfaceParameters, Units } from "../core";
import { formatLength } from "../displayUnits";

/** Show the fitted shape's size in the display units, or a placeholder when the measurements are impossible. */
export function renderSurfaceInfo(root: HTMLElement, surface: SurfaceParameters | null, units: Units): void {
  if (!surface) {
    root.innerHTML = `<h2>Pumpkin model</h2><p class="muted">Fix the measurements above to build the model.</p>`;
    return;
  }
  const { sideToSide, vertical } = surface.semiAxes;
  const fmt = (mm: number) => formatLength(mm, units);
  const intro =
    surface.kind === "ellipsoid"
      ? "An ellipsoid, round seen from above. Center to surface:"
      : "Side profile through your rings, spun around the stem; round seen from above. Center to surface:";
  root.innerHTML = `
    <h2>Pumpkin model</h2>
    <p class="muted">${intro}</p>
    <dl class="semi-axes">
      <dt>At the widest</dt><dd>${fmt(sideToSide)}</dd>
      <dt>To the top</dt><dd>${fmt(vertical)}</dd>
    </dl>
  `;
}
