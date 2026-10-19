import type { FlatTemplate, Placement, Point2, PumpkinMeasurements, SurfaceParameters, Units } from "../core";

/**
 * Pure page layout for the template PDF, in PDF points (1/72 in), origin bottom-left, y up.
 * Kept separate from drawing (render.ts) so tiling across pages, slits and test templates
 * only change what goes on which page, not how it is drawn.
 */

export type Paper = "letter" | "a4";

export const PAPER_SIZES: Record<Paper, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const PT_PER: Record<Units, number> = { in: 72, cm: 72 / 2.54 };
const PAGE_MARGIN = 18;
const CHECK_SQUARE = (100 / 25.4) * 72;
const GAP = 14;
/** Overlap between neighbouring tiles, in pt (0.5 in). */
const OVERLAP = 36;

export type MarkRole = "design" | "cut-outline" | "center-cross" | "stem-arrow" | "check-square" | "info" | "join";

/** Rectangle in pt; a mark with a clip is only drawn inside it. */
export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Mark =
  | {
      kind: "path";
      role: MarkRole;
      /** Polylines; each is closed when `closed` is set. All subpaths form one path (holes fill even-odd). */
      subpaths: Point2[][];
      closed: boolean;
      /** Outline; `dash` is [on, off] in pt, or undefined for a solid line. */
      stroke?: { width: number; dash?: number[] };
      fill?: "even-odd";
      /** 0 = black, 1 = white. */
      fillGray?: number;
      clip?: ClipRect;
    }
  | { kind: "text"; role: MarkRole; x: number; y: number; text: string; size: number; bold?: boolean; clip?: ClipRect };

export interface PageLayout {
  size: [number, number];
  marks: Mark[];
}

export interface DocumentLayout {
  title: string;
  pages: PageLayout[];
  /** False when the template is bigger than one page's printable area (it is then tiled). */
  templateFits: boolean;
  /** How the template is split across pages; 1 x 1 when it fits on one page. */
  tiles: { rows: number; cols: number };
}

export interface TemplatePdfInput {
  template: FlatTemplate;
  surface: SurfaceParameters;
  measurements: PumpkinMeasurements;
  placement: Placement;
  /** Print carve areas filled instead of outlined. */
  filled?: boolean;
  paper?: Paper;
  /** Set for a test-grid template: the ball's circumference, in the measurement units. */
  calibrationBall?: number;
}

/**
 * Lay the template out at true scale. It goes on one page with the check square and info block below it if
 * there's room; otherwise it is tiled across pages that overlap by 0.5 in, with join marks, followed by a
 * page holding the check square and info block.
 */
export function layoutTemplatePdf(input: TemplatePdfInput): DocumentLayout {
  const size = PAPER_SIZES[input.paper ?? "letter"];
  const [pageW, pageH] = size;
  const scale = PT_PER[input.template.units];

  const outline = input.template.cutOutline.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const box = bounds(outline);
  const templateW = box.maxX - box.minX;
  const templateH = box.maxY - box.minY;
  const usableW = pageW - 2 * PAGE_MARGIN;
  const usableH = pageH - 2 * PAGE_MARGIN;
  const title = "Pumpkin carving template";

  if (templateW > usableW || templateH > usableH) {
    return { title, ...tileTemplate(input, scale, box, size), templateFits: false };
  }

  const furnitureH = CHECK_SQUARE + GAP;
  const together = templateH + GAP + furnitureH <= usableH;
  // Template origin (the design center) on the page.
  const origin = {
    x: pageW / 2 - (box.minX + box.maxX) / 2,
    y: together ? pageH - PAGE_MARGIN - box.maxY : pageH / 2 - (box.minY + box.maxY) / 2,
  };
  const templateMarks = drawTemplate(input, scale, origin);
  const furniture = drawFurniture(input, PAGE_MARGIN, PAGE_MARGIN);

  return {
    title,
    pages: together
      ? [{ size, marks: [...templateMarks, ...furniture] }]
      : [{ size, marks: templateMarks }, { size, marks: furniture }],
    templateFits: true,
    tiles: { rows: 1, cols: 1 },
  };
}

/**
 * Split the template over a grid of pages. Everything is first laid out on one big "sheet" (grid lower-left at
 * 0,0); each page shows its window of the sheet, clipped to the printable area. Seam lines and crosses sit in
 * the middle of each overlap band on the sheet, so both neighbours print them in the same place.
 */
function tileTemplate(input: TemplatePdfInput, scale: number, box: ReturnType<typeof bounds>, size: [number, number]) {
  const [pageW, pageH] = size;
  const usableW = pageW - 2 * PAGE_MARGIN;
  const usableH = pageH - 2 * PAGE_MARGIN;
  const stepX = usableW - OVERLAP;
  const stepY = usableH - OVERLAP;
  const cols = Math.max(1, Math.ceil((box.maxX - box.minX - OVERLAP) / stepX));
  const rows = Math.max(1, Math.ceil((box.maxY - box.minY - OVERLAP) / stepY));
  const gridW = cols * stepX + OVERLAP;
  const gridH = rows * stepY + OVERLAP;

  const origin = { x: gridW / 2 - (box.minX + box.maxX) / 2, y: gridH / 2 - (box.minY + box.maxY) / 2 };
  const sheet = [...drawTemplate(input, scale, origin), ...seamMarks(rows, cols, stepX, stepY, gridW, gridH)];
  const clip: ClipRect = { x: PAGE_MARGIN, y: PAGE_MARGIN, width: usableW, height: usableH };
  const name = (r: number, c: number) => `${String.fromCharCode(65 + c)}${r + 1}`;
  const top = pageH - PAGE_MARGIN;
  const right = pageW - PAGE_MARGIN;
  // Labels sit just inside the overlap bands, clear of the seam lines.
  const inset = OVERLAP + 4;
  const label = (x: number, y: number, text: string): Mark => ({ kind: "text", role: "join", x, y, text, size: 7 });

  const pages: PageLayout[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // This tile's window on the sheet; row 0 is the top row.
      const dx = PAGE_MARGIN - c * stepX;
      const dy = PAGE_MARGIN - (gridH - usableH - r * stepY);
      const marks = sheet.map((m) => translate(m, dx, dy, clip));
      marks.push(label(PAGE_MARGIN + inset, top - inset - 5, `Page ${name(r, c)}  (row ${r + 1} of ${rows}, column ${c + 1} of ${cols})`));
      if (c > 0) marks.push(label(PAGE_MARGIN + inset, pageH / 2 + 4, `<- joins ${name(r, c - 1)}`));
      if (c < cols - 1) {
        const text = `joins ${name(r, c + 1)} ->`;
        marks.push(label(right - inset - textWidth(text, 7), pageH / 2 + 4, text));
      }
      if (r > 0) marks.push(label(pageW / 2 + 4, top - inset - 5, `^ joins ${name(r - 1, c)}`));
      if (r < rows - 1) marks.push(label(pageW / 2 + 4, PAGE_MARGIN + inset, `v joins ${name(r + 1, c)}`));
      pages.push({ size, marks });
    }
  }

  const noteY = PAGE_MARGIN + CHECK_SQUARE + 2 * GAP;
  const note: Mark[] = [
    label(PAGE_MARGIN, noteY + 12, `Tiled on ${rows * cols} pages (${rows} rows x ${cols} columns), page A1 at the top left.`),
    label(PAGE_MARGIN, noteY, "Trim a page along its dotted line, lay it over its neighbour so the dotted lines and crosses match, and tape."),
  ].map((m) => ({ ...m, size: 8.5 }));
  pages.push({ size, marks: [...drawFurniture(input, PAGE_MARGIN, PAGE_MARGIN), ...note] });
  return { pages, tiles: { rows, cols } };
}

/** Dotted seam lines along the middle of every overlap band, with alignment crosses on them. */
function seamMarks(rows: number, cols: number, stepX: number, stepY: number, gridW: number, gridH: number): Mark[] {
  const seam = (a: Point2, b: Point2): Mark => ({
    kind: "path",
    role: "join",
    subpaths: [[a, b]],
    closed: false,
    stroke: { width: 0.4, dash: [1, 2] },
  });
  const cross = ({ x, y }: Point2): Mark => ({
    kind: "path",
    role: "join",
    subpaths: [
      [{ x: x - 7, y }, { x: x + 7, y }],
      [{ x, y: y - 7 }, { x, y: y + 7 }],
    ],
    closed: false,
    stroke: { width: 0.5 },
  });
  // Cross positions along a seam: a quarter and three quarters into each tile it borders.
  const along = (n: number, step: number) =>
    Array.from({ length: n }, (_, i) => [0.25, 0.75].map((f) => i * step + OVERLAP + (step - OVERLAP) * f)).flat();

  const marks: Mark[] = [];
  for (let c = 1; c < cols; c++) {
    const x = c * stepX + OVERLAP / 2;
    marks.push(seam({ x, y: 0 }, { x, y: gridH }), ...along(rows, stepY).map((y) => cross({ x, y })));
  }
  for (let r = 1; r < rows; r++) {
    const y = r * stepY + OVERLAP / 2;
    marks.push(seam({ x: 0, y }, { x: gridW, y }), ...along(cols, stepX).map((x) => cross({ x, y })));
    for (let c = 1; c < cols; c++) marks.push(cross({ x: c * stepX + OVERLAP / 2, y }));
  }
  return marks;
}

function translate(mark: Mark, dx: number, dy: number, clip: ClipRect): Mark {
  if (mark.kind === "text") return { ...mark, x: mark.x + dx, y: mark.y + dy, clip };
  return { ...mark, subpaths: mark.subpaths.map((sub) => sub.map((p) => ({ x: p.x + dx, y: p.y + dy }))), clip };
}

/** Rough Helvetica width, for right-aligning short labels. */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

function drawTemplate({ template, filled }: TemplatePdfInput, scale: number, origin: Point2): Mark[] {
  const place = (p: Point2): Point2 => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale });
  const design = template.designPaths.map((path) => path.map(place));
  const designTop = Math.max(...design.flat().map((p) => p.y));
  const cutTop = Math.max(...template.cutOutline.map((p) => place(p).y));

  const marks: Mark[] = [
    {
      kind: "path",
      role: "design",
      subpaths: design,
      closed: true,
      stroke: { width: 0.5 },
      ...(filled ? { fill: "even-odd" as const, fillGray: 0.6 } : {}),
    },
    { kind: "path", role: "cut-outline", subpaths: [template.cutOutline.map(place)], closed: true, stroke: { width: 1 } },
    {
      kind: "path",
      role: "center-cross",
      subpaths: [
        [{ x: origin.x - 10, y: origin.y }, { x: origin.x + 10, y: origin.y }],
        [{ x: origin.x, y: origin.y - 10 }, { x: origin.x, y: origin.y + 10 }],
      ],
      closed: false,
      stroke: { width: 0.5 },
    },
  ];

  // Stem arrow (+y on the template) in the margin band between the design and the cut-out edge.
  const room = cutTop - designTop;
  const base = designTop + room * 0.15;
  const tip = designTop + room * 0.75;
  const head = Math.min(8, (tip - base) / 2);
  marks.push(
    {
      kind: "path",
      role: "stem-arrow",
      subpaths: [[{ x: origin.x, y: base }, { x: origin.x, y: tip - head }]],
      closed: false,
      stroke: { width: 0.75 },
    },
    {
      kind: "path",
      role: "stem-arrow",
      subpaths: [[{ x: origin.x - head / 2, y: tip - head }, { x: origin.x + head / 2, y: tip - head }, { x: origin.x, y: tip }]],
      closed: true,
      fill: "even-odd",
      fillGray: 0,
    },
    { kind: "text", role: "stem-arrow", x: origin.x + 4, y: base, text: "stem", size: 7 },
  );
  return marks;
}

/** The 10 cm check square and the info block, with the square's lower-left corner at (x, y). */
function drawFurniture(
  { measurements, surface, placement, filled, calibrationBall }: TemplatePdfInput,
  x: number,
  y: number,
): Mark[] {
  const u = measurements.units;
  const len = (v: number) => `${fmt(v)} ${u}`;
  const { sideToSide, frontToBack, vertical } = surface.semiAxes;
  const lines: [string, number, boolean?][] = [
    [calibrationBall ? `Calibration grid for a ${len(calibrationBall)} ball` : "Pumpkin carving template", 11, true],
    [`Circumference: ${len(measurements.circumference)}`, 8.5],
    [`Front arc (stem to base): ${len(measurements.frontArc)}`, 8.5],
    [`Depth: ${measurements.depth ? len(measurements.depth) : "not given (round)"}`, 8.5],
    [`Fitted shape: ${fmt(2 * sideToSide)} x ${fmt(2 * frontToBack)} x ${fmt(2 * vertical)} ${u}`, 8.5],
    ["  (width x depth x height)", 8.5],
    [`Design width seen from the front: ${len(placement.width)}`, 8.5],
    [`Moved up: ${len(placement.verticalOffset)}   Rotation: ${fmt(placement.rotation)}°`, 8.5],
    [`Carve areas: ${filled ? "filled" : "outlines"}`, 8.5],
    ["", 8.5],
    ["Cut along the solid line.", 8.5],
    ["Line up the center cross with the design's center", 8.5],
    ["on the pumpkin, arrow toward the stem.", 8.5],
    ["", 8.5],
    ["Print at 100% (Actual size).", 8.5, true],
    ["The square must measure 10 cm on each side.", 8.5],
  ];

  const square: Point2[] = [
    { x, y },
    { x: x + CHECK_SQUARE, y },
    { x: x + CHECK_SQUARE, y: y + CHECK_SQUARE },
    { x, y: y + CHECK_SQUARE },
  ];
  const marks: Mark[] = [
    { kind: "path", role: "check-square", subpaths: [square], closed: true, stroke: { width: 0.5 } },
    { kind: "text", role: "check-square", x: x + 4, y: y + CHECK_SQUARE - 12, text: "10 cm x 10 cm", size: 8 },
  ];
  let lineY = y + CHECK_SQUARE - 11;
  for (const [text, size, bold] of lines) {
    marks.push({ kind: "text", role: "info", x: x + CHECK_SQUARE + GAP, y: lineY, text, size, bold });
    lineY -= size + 3;
  }
  return marks;
}

function bounds(points: Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}
