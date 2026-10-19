import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildTemplate, type Placement, type PumpkinMeasurements } from "../src/core";
import { layoutTemplatePdf, type Mark } from "../src/pdf/layout";
import { renderPdf } from "../src/pdf/render";

const measurements: PumpkinMeasurements = { circumference: 2000, frontArc: 1000, units: "in" };
const placement: Placement = { width: 4, verticalOffset: 0, rotation: 0 };
const result = buildTemplate({
  measurements,
  design: { paths: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]], bbox: { minX: 0, minY: 0, maxX: 4, maxY: 2 } },
  placement,
});
const input = { template: result.template!, surface: result.surface!, measurements, placement };

function bbox(mark: Mark) {
  const pts = mark.kind === "path" ? mark.subpaths.flat() : [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
const find = (marks: Mark[], role: Mark["role"]) => marks.filter((m) => m.role === role);

describe("PDF layout", () => {
  it("draws the template at true scale (1 in = 72 pt) on one Letter page", () => {
    const layout = layoutTemplatePdf(input);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].size).toEqual([612, 792]);
    const [design] = find(layout.pages[0].marks, "design");
    expect(bbox(design).width).toBeCloseTo(4 * 72, 0);
    const [cut] = find(layout.pages[0].marks, "cut-outline");
    expect(bbox(cut).width).toBeCloseTo(5.5 * 72, 0);
    // Solid: stroked, without a dash pattern.
    expect(cut).toHaveProperty("stroke");
    expect(cut).not.toHaveProperty("stroke.dash");
  });

  it("includes a 10 cm check square, a center cross, a stem arrow and the measurements", () => {
    const { marks } = layoutTemplatePdf(input).pages[0];

    const [square] = find(marks, "check-square");
    expect(bbox(square).width).toBeCloseTo((100 / 25.4) * 72, 3);
    expect(bbox(square).height).toBeCloseTo((100 / 25.4) * 72, 3);
    expect(find(marks, "center-cross")).not.toHaveLength(0);
    expect(find(marks, "stem-arrow")).not.toHaveLength(0);
    const info = find(marks, "info").map((m) => (m.kind === "text" ? m.text : "")).join("\n");
    expect(info).toContain("2000 in");
    expect(info).toContain("1000 in");
  });

  it("outlines carve areas by default and fills them on request", () => {
    const [outlined] = find(layoutTemplatePdf(input).pages[0].marks, "design");
    const [filled] = find(layoutTemplatePdf({ ...input, filled: true }).pages[0].marks, "design");

    expect(outlined).not.toHaveProperty("fill");
    expect(filled).toMatchObject({ fill: "even-odd" });
  });

  it("draws the slits as dashed lines", () => {
    const slits = [[{ x: 0, y: 2 }, { x: 0, y: 1.5 }, { x: 0.01, y: 2 }]];
    const { marks } = layoutTemplatePdf({ ...input, template: { ...input.template, slits } }).pages[0];

    const [slit] = find(marks, "slit");
    expect(slit).toMatchObject({ kind: "path", closed: false });
    expect(slit).toHaveProperty("stroke.dash");
    expect(bbox(slit).height).toBeCloseTo(0.5 * 72, 3);
  });

  it("renders to a one-page PDF", async () => {
    const bytes = await renderPdf(layoutTemplatePdf(input));
    const doc = await PDFDocument.load(bytes);

    expect(doc.getPageCount()).toBe(1);
  });
});
