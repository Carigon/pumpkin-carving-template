import type { Point2 } from "../core";
import type { PaperView } from "../paperView";
import type { ClipRect } from "../pdf/layout";
import { STRETCH_MAX_ALPHA } from "../stretchTint";
import { el, roundTo } from "./svg";

/** For unique clip-path ids. */
let clipCount = 0;

export interface PaperViewPane {
  /** Draw the template on its pages (`filled`: carve areas filled, as the PDF prints them). */
  show(view: PaperView, filled: boolean): void;
  /** Nothing to draw: show a message instead. */
  empty(text: string): void;
}

/**
 * The Paper view: a schematic SVG of the flat template across the printed pages (not a rendering of the PDF).
 * It only draws what `paperView` returns; the geometry is in the template's frame (y up), flipped here for SVG.
 */
export function mountPaperView(root: HTMLElement): PaperViewPane {
  root.innerHTML = `
    <div class="paper-fit"></div>
    <div class="paper-caption" hidden></div>
    <div class="paper-placeholder" hidden></div>
  `;
  const fit = root.querySelector<HTMLElement>(".paper-fit")!;
  const caption = root.querySelector<HTMLElement>(".paper-caption")!;
  const placeholder = root.querySelector<HTMLElement>(".paper-placeholder")!;

  return {
    show(view, filled) {
      placeholder.hidden = true;
      fit.replaceChildren(drawing(view, filled));
      const n = view.pages.length;
      const extra = view.pageCount - n;
      caption.textContent =
        `${n} ${n === 1 ? "page" : "pages"} with the template` + (extra > 0 ? `, plus ${extra} info page` : "") + ` (${view.pageCount} in the PDF)`;
      caption.hidden = false;
    },
    empty(text) {
      fit.replaceChildren();
      caption.hidden = true;
      placeholder.textContent = text;
      placeholder.hidden = false;
    },
  };
}

function drawing(view: PaperView, filled: boolean): SVGSVGElement {
  // Everything in the template frame, y flipped for SVG.
  const xy = (p: Point2) => `${round(p.x)},${round(-p.y)}`;
  const box = bounds([
    ...view.pages.flatMap(({ sheet }) => oppositeCorners(sheet)),
    ...(view.outline ?? []),
    ...view.design.flat(),
  ]);
  const pad = 0.03 * Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const svg = el("svg", {
    viewBox: `${round(box.minX - pad)} ${round(-box.maxY - pad)} ${round(box.maxX - box.minX + 2 * pad)} ${round(box.maxY - box.minY + 2 * pad)}`,
    role: "img",
    "aria-label": "The flat template on the printed pages",
    preserveAspectRatio: "xMidYMid meet",
  }) as SVGSVGElement;

  const rect = (r: ClipRect, cls: string) =>
    el("rect", { class: cls, x: round(r.x), y: round(-(r.y + r.height)), width: round(r.width), height: round(r.height) });
  const sheets = el("g", { class: "paper-sheets" });
  for (const page of view.pages) sheets.append(rect(page.sheet, "paper-sheet"));
  for (const page of view.pages) sheets.append(rect(page.printable, "paper-printable"));
  // Page names in each sheet's top-left corner, inside the printable area (as the PDF prints its tile names).
  for (const page of view.pages) {
    const { printable, sheet } = page;
    const size = 0.045 * Math.min(sheet.width, sheet.height);
    const label = el("text", {
      class: "paper-page-label",
      x: round(printable.x + 0.3 * size),
      y: round(-(printable.y + printable.height) + 1.1 * size),
      "font-size": round(size),
    });
    const number = page.index + 1;
    label.textContent = view.pages.length > 1 ? `${page.name} · page ${number}` : `Page ${number}`;
    sheets.append(label);
  }

  // Tint only the paper that's left after cutting.
  const clipId = `paper-clip-${++clipCount}`;
  const clip = el("clipPath", { id: clipId });
  clip.append(el("path", { d: `M${view.paperArea.map(xy).join("L")}Z` }));
  const defs = el("defs", {});
  defs.append(clip);
  const tint = el("g", { class: "paper-stretch", "clip-path": `url(#${clipId})` });
  // Every triangle, untinted ones too, so hovering anywhere on the patch shows its stretch value.
  for (const t of view.stretch) {
    const triangle = el("polygon", { points: t.corners.map(xy).join(" "), "fill-opacity": round(STRETCH_MAX_ALPHA * t.tint) });
    const title = el("title", {});
    title.textContent = `Stretch ${(100 * t.value).toFixed(1)} %`;
    triangle.append(title);
    tint.append(triangle);
  }

  const path = (lines: Point2[][], closed: boolean) =>
    lines.map((line) => `M${line.map(xy).join("L")}${closed ? "Z" : ""}`).join("");
  const design = el("path", { class: filled ? "paper-design filled" : "paper-design", d: path(view.design, true) });
  svg.append(defs, sheets, tint, design);
  if (view.outline) svg.append(el("path", { class: "paper-outline", d: path([view.outline], true) }));
  if (view.slits.length > 0) svg.append(el("path", { class: "paper-slits", d: path(view.slits, false) }));
  return svg;
}

/** The rectangle's lower-left and upper-right corners (enough for a bounding box). */
function oppositeCorners(r: ClipRect): Point2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
  ];
}

function bounds(points: Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Template-frame lengths to 0.001. */
function round(v: number): number {
  return roundTo(v, 3);
}
