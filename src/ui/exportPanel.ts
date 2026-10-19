import type { TemplatePdfInput } from "../pdf/layout";

export interface ExportPanel {
  /** What to export, or null when there is no template yet. */
  setSource(source: Omit<TemplatePdfInput, "filled"> | null): void;
}

/** "Download PDF" button with the carve-area style option. pdf-lib is loaded on first export. */
export function mountExportPanel(root: HTMLElement): ExportPanel {
  root.innerHTML = `
    <h2>Template</h2>
    <form class="export" novalidate>
      <label class="check"><input id="x-filled" type="checkbox" /> Print carve areas filled (default: outlines)</label>
      <button id="x-download" type="submit" disabled>Download PDF</button>
      <small class="hint" id="x-status">Load a design to make a template.</small>
    </form>
  `;
  const form = root.querySelector("form")!;
  const filled = form.querySelector<HTMLInputElement>("#x-filled")!;
  const button = form.querySelector<HTMLButtonElement>("#x-download")!;
  const status = form.querySelector<HTMLElement>("#x-status")!;
  let source: Omit<TemplatePdfInput, "filled"> | null = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!source) return;
    button.disabled = true;
    try {
      const [{ layoutTemplatePdf }, { renderPdf, downloadPdf }] = await Promise.all([
        import("../pdf/layout"),
        import("../pdf/render"),
      ]);
      const layout = layoutTemplatePdf({ ...source, filled: filled.checked });
      downloadPdf(await renderPdf(layout), "pumpkin-template.pdf");
      status.textContent = layout.templateFits
        ? "Print at 100% (Actual size) and check the 10 cm square."
        : "The template is bigger than one page and is cut off at the page edge. Try a smaller design width.";
    } finally {
      button.disabled = source === null;
    }
  });

  return {
    setSource(next) {
      source = next;
      button.disabled = next === null;
      status.textContent = next ? "One page, true scale." : "Load a design that lands on the pumpkin to make a template.";
    },
  };
}
