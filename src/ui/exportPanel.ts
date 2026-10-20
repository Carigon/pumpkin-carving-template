import type { Units } from "../core";
import type { Paper } from "../paper";
import { layoutTemplatePdf, type TemplatePdfInput } from "../pdf/layout";

/** What the panel exports: everything the PDF needs except the panel's own options and the display units. */
export type ExportSource = Omit<TemplatePdfInput, "filled" | "paper" | "units">;

export interface ExportPanel {
  /** What to export, or null when there is no template yet. */
  setSource(source: ExportSource | null): void;
  /** The template is being rebuilt for the latest edit: no export until `setSource` brings it. */
  setUpdating(): void;
  /** The template couldn't be built. */
  setFailed(message: string): void;
  options(): { paper: Paper; filled: boolean };
  /** Put back saved options. Doesn't call `onChange`. */
  restore(saved: { paper?: Paper; filled?: boolean }): void;
}

/**
 * "Download PDF" button with the paper size and carve-area style options. pdf-lib is loaded on first export. The
 * info block prints lengths in the display units `units` returns at the time. Calls `onChange` when an option changes.
 */
export function mountExportPanel(root: HTMLElement, units: () => Units, onChange: () => void = () => {}): ExportPanel {
  root.innerHTML = `
    <form class="export card" novalidate>
      <h2>Paper and PDF</h2>
      <div class="field">
        <label for="x-paper">Paper</label>
        <div class="input-row">
          <select id="x-paper">
            <option value="letter">Letter (8.5 x 11 in)</option>
            <option value="a4">A4 (210 x 297 mm)</option>
          </select>
        </div>
      </div>
      <div class="field checkbox">
        <label><input id="x-filled" type="checkbox" /> Print carve areas filled (default: outlines)</label>
      </div>
      <div class="field">
        <div class="input-row"><button id="x-download" type="submit" class="primary" disabled>Download PDF</button></div>
        <div class="hint" id="x-status" aria-live="polite">Load a design to make a template.</div>
      </div>
    </form>
  `;
  const form = root.querySelector("form")!;
  const paper = form.querySelector<HTMLSelectElement>("#x-paper")!;
  const filled = form.querySelector<HTMLInputElement>("#x-filled")!;
  const button = form.querySelector<HTMLButtonElement>("#x-download")!;
  const status = form.querySelector<HTMLElement>("#x-status")!;
  let source: ExportSource | null = null;
  let exporting = false;
  const refreshButton = () => (button.disabled = exporting || source === null);
  /** No export until a fresh template arrives. */
  const block = (message: string) => {
    source = null;
    refreshButton();
    status.textContent = message;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // The template as it was when the button was pressed, even if an edit comes in while pdf-lib loads.
    const current = source;
    if (!current || exporting) return;
    exporting = true;
    refreshButton();
    try {
      // The page layout is already loaded (the Paper view uses it); pdf-lib loads on first export.
      const { renderPdf, downloadPdf } = await import("../pdf/render");
      const layout = layoutTemplatePdf({ ...current, filled: filled.checked, paper: paper.value as Paper, units: units() });
      downloadPdf(await renderPdf(layout), "pumpkin-template.pdf");
      const { rows, cols } = layout.tiles;
      // An edit during the export already set its own status ("updating…"); keep that one.
      if (source === current) status.textContent = layout.templateFits
        ? "Print at 100% (Actual size) and check the 10 cm square."
        : `Tiled on ${rows * cols} pages (${rows} x ${cols}) plus an info page. Print at 100% (Actual size), ` +
          "check the 10 cm square, then tape the pages together matching the dotted lines and crosses.";
    } finally {
      exporting = false;
      refreshButton();
    }
  });

  form.addEventListener("change", () => onChange());

  return {
    options: () => ({ paper: paper.value as Paper, filled: filled.checked }),
    restore(saved) {
      if (saved.paper) paper.value = saved.paper;
      if (saved.filled !== undefined) filled.checked = saved.filled;
    },
    setUpdating: () => block("Updating the template…"),
    setFailed: (message) => block(`The template couldn't be built: ${message}`),
    setSource(next) {
      source = next;
      refreshButton();
      status.textContent = next
        ? "True scale. Templates bigger than a page are split across pages."
        : "Load a design that lands on the pumpkin to make a template.";
    },
  };
}
