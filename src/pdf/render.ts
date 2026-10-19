import {
  closePath,
  endPath,
  lineTo,
  moveTo,
  PDFDocument,
  PDFOperator,
  PDFOperatorNames,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setFillingGrayscaleColor,
  setLineWidth,
  setStrokingGrayscaleColor,
  StandardFonts,
  stroke,
} from "pdf-lib";
import type { DocumentLayout, Mark } from "./layout";

/** Draw a laid-out document with pdf-lib. Vector only: paths are raw PDF path operators in points. */
export async function renderPdf(layout: DocumentLayout): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(layout.title);
  doc.setCreator("sphereprojection");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const { size, marks } of layout.pages) {
    const page = doc.addPage(size);
    for (const mark of marks) {
      if (mark.kind === "text") {
        if (mark.text) page.drawText(mark.text, { x: mark.x, y: mark.y, size: mark.size, font: mark.bold ? bold : regular, color: rgb(0, 0, 0) });
      } else {
        page.pushOperators(...pathOperators(mark));
      }
    }
  }
  return doc.save();
}

function pathOperators(mark: Extract<Mark, { kind: "path" }>): PDFOperator[] {
  const ops: PDFOperator[] = [pushGraphicsState(), setStrokingGrayscaleColor(0)];
  if (mark.stroke) ops.push(setLineWidth(mark.stroke.width), setDashPattern(mark.stroke.dash ?? [], 0));
  if (mark.fill) ops.push(setFillingGrayscaleColor(mark.fillGray ?? 0));
  for (const sub of mark.subpaths) {
    if (sub.length === 0) continue;
    ops.push(moveTo(sub[0].x, sub[0].y));
    for (let i = 1; i < sub.length; i++) ops.push(lineTo(sub[i].x, sub[i].y));
    if (mark.closed) ops.push(closePath());
  }
  if (mark.fill && mark.stroke) ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOddAndStroke));
  else if (mark.fill) ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd));
  else if (mark.stroke) ops.push(stroke());
  else ops.push(endPath());
  ops.push(popGraphicsState());
  return ops;
}

/** Offer the PDF as a download in the browser. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
