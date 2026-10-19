import type { Paper } from "../paper";
import type { TemplatePdfInput } from "../pdf/layout";

export interface ExportPanel {
  /** What to export, or null when there is no template yet. */
  setSource(source: Omit<TemplatePdfInput, "filled" | "paper"> | null): void;
  options(): { paper: Paper; filled: boolean };
  /** Put back saved options. Doesn't call `onChange`. */
  restore(saved: { paper?: Paper; filled?: boolean }): void;
}

/**
 * "Download PDF" button with the paper size and carve-area style options. pdf-lib is loaded on first export.
 * Calls `onChange` when an option changes.
 */
export function mountExportPanel(root: HTMLElement, onChange: () => void = () => {}): ExportPanel {
  root.innerHTML = `
    <h2>Template</h2>
    <form class="export" novalidate>
      <label>Paper
        <select id="x-paper">
          <option value="letter">Letter (8.5 x 11 in)</option>
          <option value="a4">A4 (210 x 297 mm)</option>
        </select>
      </label>
      <label class="check"><input id="x-filled" type="checkbox" /> Print carve areas filled (default: outlines)</label>
      <button id="x-download" type="submit" disabled>Download PDF</button>
      <small class="hint" id="x-status">Load a design to make a template.</small>
    </form>
  `;
  const form = root.querySelector("form")!;
  const paper = form.querySelector<HTMLSelectElement>("#x-paper")!;
  const filled = form.querySelector<HTMLInputElement>("#x-filled")!;
  const button = form.querySelector<HTMLButtonElement>("#x-download")!;
  const status = form.querySelector<HTMLElement>("#x-status")!;
  let source: Omit<TemplatePdfInput, "filled" | "paper"> | null = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!source) return;
    button.disabled = true;
    try {
      const [{ layoutTemplatePdf }, { renderPdf, downloadPdf }] = await Promise.all([
        import("../pdf/layout"),
        import("../pdf/render"),
      ]);
      const layout = layoutTemplatePdf({ ...source, filled: filled.checked, paper: paper.value as Paper });
      downloadPdf(await renderPdf(layout), "pumpkin-template.pdf");
      const { rows, cols } = layout.tiles;
      status.textContent = layout.templateFits
        ? "Print at 100% (Actual size) and check the 10 cm square."
        : `Tiled on ${rows * cols} pages (${rows} x ${cols}) plus an info page. Print at 100% (Actual size), ` +
          "check the 10 cm square, then tape the pages together matching the dotted lines and crosses.";
    } finally {
      button.disabled = source === null;
    }
  });

  form.addEventListener("change", () => onChange());

  return {
    options: () => ({ paper: paper.value as Paper, filled: filled.checked }),
    restore(saved) {
      if (saved.paper) paper.value = saved.paper;
      if (saved.filled !== undefined) filled.checked = saved.filled;
    },
    setSource(next) {
      source = next;
      button.disabled = next === null;
      status.textContent = next
        ? "True scale. Templates bigger than a page are split across pages."
        : "Load a design that lands on the pumpkin to make a template.";
    },
  };
}
