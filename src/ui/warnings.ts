import type { TemplateWarning } from "../core";

/** Which panel shows each kind of warning (measurement warnings sit next to their own field instead). */
export const WARNING_PANEL: Record<TemplateWarning["kind"], "measurements" | "design" | "slits"> = {
  "impossible-measurement": "measurements",
  "outside-silhouette": "design",
  "past-front-limit": "design",
  "slit-shortened": "slits",
};

/** Show the warnings that belong to `panel` in `el`, one block each. */
export function renderWarnings(el: HTMLElement, warnings: TemplateWarning[], panel: "design" | "slits"): void {
  el.replaceChildren(
    ...warnings
      .filter((w) => WARNING_PANEL[w.kind] === panel)
      .map((w) => {
        const div = document.createElement("div");
        div.className = "warning";
        div.dataset.kind = w.kind;
        div.textContent = w.message;
        return div;
      }),
  );
}
