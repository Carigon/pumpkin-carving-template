import type { SurfaceParameters } from "../core";

/** Show the fitted shape's size, or a placeholder when the measurements are impossible. */
export function renderSurfaceInfo(root: HTMLElement, surface: SurfaceParameters | null): void {
  if (!surface) {
    root.innerHTML = `<h2>Pumpkin model</h2><p class="muted">Fix the measurements above to build the model.</p>`;
    return;
  }
  const { sideToSide, frontToBack, vertical } = surface.semiAxes;
  const fmt = (x: number) => `${x.toFixed(2)} ${surface.units}`;
  const intro =
    surface.kind === "ellipsoid"
      ? "Ellipsoid semi-axes (center to surface):"
      : "Side profile through your rings, spun around the stem. Center to surface at the widest:";
  root.innerHTML = `
    <h2>Pumpkin model</h2>
    <p class="muted">${intro}</p>
    <dl class="semi-axes">
      <dt>Side to side</dt><dd>${fmt(sideToSide)}</dd>
      <dt>Front to back</dt><dd>${fmt(frontToBack)}</dd>
      <dt>Center to stem</dt><dd>${fmt(vertical)}</dd>
    </dl>
  `;
}
