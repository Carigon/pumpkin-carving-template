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

export type MarkRole = "design" | "cut-outline" | "center-cross" | "stem-arrow" | "check-square" | "info";

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
    }
  | { kind: "text"; role: MarkRole; x: number; y: number; text: string; size: number; bold?: boolean };

export interface PageLayout {
  size: [number, number];
  marks: Mark[];
}

export interface DocumentLayout {
  title: string;
  pages: PageLayout[];
  /** False when the template is bigger than one page's printable area (it is then clipped). */
  templateFits: boolean;
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

/** Lay the template out at true scale on one page, with the check square and info block below it if there's room. */
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
  const furnitureH = CHECK_SQUARE + GAP;
  const together = templateH + GAP + furnitureH <= usableH && templateW <= usableW;

  // Template origin (the design center) on the page.
  const origin = {
    x: pageW / 2 - (box.minX + box.maxX) / 2,
    y: together ? pageH - PAGE_MARGIN - box.maxY : pageH / 2 - (box.minY + box.maxY) / 2,
  };
  const templateMarks = drawTemplate(input, scale, origin);
  const furniture = drawFurniture(input, PAGE_MARGIN, PAGE_MARGIN);

  return {
    title: "Pumpkin carving template",
    pages: together
      ? [{ size, marks: [...templateMarks, ...furniture] }]
      : [{ size, marks: templateMarks }, { size, marks: furniture }],
    templateFits: templateW <= usableW && templateH <= usableH,
  };
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
