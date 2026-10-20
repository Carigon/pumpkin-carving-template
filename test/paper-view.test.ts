import { describe, expect, it } from "vitest";
import { buildTemplate, type Design, type Placement, type PumpkinMeasurements, type SlitOptions } from "../src/core";
import { ballMeasurements, gridDesign } from "../src/input/calibrationGrid";
import { paperView } from "../src/paperView";
import { layoutTemplatePdf, type Mark, type TemplatePdfInput } from "../src/pdf/layout";

/** mm per inch. */
const IN = 25.4;
/** PDF points per mm. */
const PT = 72 / IN;
const pumpkin: PumpkinMeasurements = {
  height: 10 * IN,
  rings: [{ position: 0.4, circumference: 32 * IN }, { position: 0.8, circumference: 22 * IN }],
};
const rectangle: Design = {
  paths: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]],
  bbox: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
};

/** A template built through the template builder, with what the PDF needs alongside it. */
function source(options: { width?: number; slits?: SlitOptions; line?: boolean; measurements?: PumpkinMeasurements; design?: Design } = {}): TemplatePdfInput {
  const measurements = options.measurements ?? pumpkin;
  const placement: Placement = { width: (options.width ?? 4) * IN, verticalOffset: 0, rotation: 0 };
  const slits = options.slits ?? { count: 6, depth: 0.8 * IN };
  const margin = 0.75 * IN;
  const built = buildTemplate({ measurements, design: options.design ?? rectangle, placement, slits, margin });
  return {
    template: built.template!,
    surface: built.surface!,
    measurements,
    placement,
    slits,
    cut: { margin, line: options.line ?? true },
    units: "in",
  };
}

const find = (marks: Mark[], role: Mark["role"]) => marks.filter((m) => m.role === role);

/** Where the template's origin (design center) sits on a PDF page, in pt: the middle of its center cross. */
function originOn(marks: Mark[]) {
  const [cross] = find(marks, "center-cross");
  if (!cross || cross.kind !== "path") return null;
  const [h, v] = cross.subpaths;
  return { x: (h[0].x + h[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
}

describe("Paper view page tiles", () => {
  it.each(["letter", "a4"] as const)("match the PDF's tiled pages: count, positions and numbering (%s)", (paper) => {
    const input = { ...source({ width: 16, measurements: { height: 1000 * IN, rings: [{ circumference: 2000 * IN, position: 0.5 }] } }), paper };
    const layout = layoutTemplatePdf(input);
    const pdfTiles = layout.pages.map((page, index) => ({ page, index })).filter(({ page }) => find(page.marks, "design").length > 0);

    const view = paperView(input);

    expect(pdfTiles.length).toBeGreaterThan(1);
    expect(view.pageCount).toBe(layout.pages.length);
    expect(view.pages.map((p) => p.index)).toEqual(pdfTiles.map((t) => t.index));
    for (const [i, tile] of view.pages.entries()) {
      const { page } = pdfTiles[i];
      const o = originOn(page.marks)!;
      const [w, h] = page.size;
      // The whole sheet and its printable area, in mm from the design center.
      expect(tile.sheet.x).toBeCloseTo(-o.x / PT, 5);
      expect(tile.sheet.y).toBeCloseTo(-o.y / PT, 5);
      expect(tile.sheet.width).toBeCloseTo(w / PT, 5);
      expect(tile.sheet.height).toBeCloseTo(h / PT, 5);
      const clip = find(page.marks, "design")[0].clip!;
      expect(tile.printable.x).toBeCloseTo((clip.x - o.x) / PT, 5);
      expect(tile.printable.y).toBeCloseTo((clip.y - o.y) / PT, 5);
      expect(tile.printable.width).toBeCloseTo(clip.width / PT, 5);
      expect(tile.printable.height).toBeCloseTo(clip.height / PT, 5);
      const label = find(page.marks, "join").find((m) => m.kind === "text" && m.text.startsWith("Page "));
      expect(label?.kind === "text" && label.text).toContain(`Page ${tile.name} `);
    }
  });

  it("show one page where the template fits on one", () => {
    const input = { ...source(), paper: "letter" as const };
    const layout = layoutTemplatePdf(input);
    const o = originOn(layout.pages[0].marks)!;

    const view = paperView(input);

    expect(view.pageCount).toBe(layout.pages.length);
    expect(view.pages).toHaveLength(1);
    const [tile] = view.pages;
    expect(tile.index).toBe(0);
    expect(tile.name).toBe("1");
    expect(tile.sheet.x).toBeCloseTo(-o.x / PT, 5);
    expect(tile.sheet.y).toBeCloseTo(-o.y / PT, 5);
    expect(tile.sheet.width).toBeCloseTo(612 / PT, 5);
    expect(tile.sheet.height).toBeCloseTo(792 / PT, 5);
  });
});

describe("Paper view template", () => {
  it("draws the cut-out outline when the cut line is printed", () => {
    const input = source({ line: true });
    expect(paperView(input).outline).toEqual(input.template.cutOutline);
  });

  it("has no outline when the cut line is off", () => {
    const input = source({ line: false });
    const view = paperView(input);
    expect(view.outline).toBeNull();
    // The paper is still cut to the same shape, just without a printed line.
    expect(view.paperArea).toEqual(input.template.cutOutline);
  });

  it("draws the design lines and the slits, running in from the cut-out edge, in the template's frame", () => {
    // Two blocks with a gap between them, so slits can run in.
    const blocks: Design = {
      paths: [rectangle.paths[0].map(({ x, y }) => ({ x: x / 2, y })), rectangle.paths[0].map(({ x, y }) => ({ x: x / 2 + 4, y }))],
      bbox: { minX: 0, minY: 0, maxX: 6, maxY: 3 },
    };
    const input = source({ design: blocks, width: 6, slits: { count: 2, depth: 2 * IN } });
    const view = paperView(input);

    expect(view.design).toEqual(input.template.designPaths);
    expect(view.slits.length).toBeGreaterThan(0);
    expect(view.slits).toEqual(input.template.slits);
    const edge = bbox(input.template.cutOutline);
    for (const slit of view.slits) {
      // Each slit starts and ends on the edge and its tip reaches inside.
      for (const end of [slit[0], slit[slit.length - 1]]) expect(distanceTo(input.template.cutOutline, end)).toBeLessThan(0.05 * IN);
      expect(Math.max(...slit.map((p) => distanceTo(input.template.cutOutline, p)))).toBeGreaterThan(0.2 * IN);
      for (const p of slit) expect(inside(p, edge)).toBe(true);
    }
  });

  it("covers the paper under the design with stretch triangles, tinted like the 3D view", () => {
    const input = source();
    const view = paperView(input);

    expect(view.stretch.length).toBe(input.template.stretch.values.length);
    const patch = bbox(view.stretch.flatMap((t) => t.corners));
    for (const p of input.template.designPaths.flat()) expect(inside(p, patch)).toBe(true);
    const edge = bbox(input.template.cutOutline);
    for (const t of view.stretch) {
      for (const c of t.corners) expect(inside(c, edge, 0.5 * IN)).toBe(true);
      // Faint from about 3 %, solid from 15 %.
      if (t.value <= 0.03) expect(t.tint).toBe(0);
      else if (t.value >= 0.15) expect(t.tint).toBe(1);
      else {
        expect(t.tint).toBeGreaterThan(0);
        expect(t.tint).toBeLessThan(1);
      }
    }
    expect(view.stretch.map((t) => t.value)).toEqual(input.template.stretch.values);
  });
});

describe("Paper view in test-grid mode", () => {
  it("shows the grid template with no slits, on the PDF's pages", () => {
    const ball = 29.5 * IN;
    const input: TemplatePdfInput = {
      ...source({ measurements: ballMeasurements(ball), design: gridDesign(4), width: 6, slits: { count: 0, depth: 0 } }),
      calibrationBall: ball,
      paper: "a4",
    };
    const view = paperView(input);

    expect(view.slits).toEqual([]);
    expect(view.design).toHaveLength(1 + 16);
    expect(view.outline).not.toBeNull();
    expect(view.pages.length).toBeGreaterThan(0);
    expect(view.pageCount).toBe(layoutTemplatePdf(input).pages.length);
  });
});

function bbox(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function inside(p: { x: number; y: number }, b: ReturnType<typeof bbox>, slack = 1e-9) {
  return p.x >= b.minX - slack && p.x <= b.maxX + slack && p.y >= b.minY - slack && p.y <= b.maxY + slack;
}

/** Distance from a point to a closed polyline. */
function distanceTo(polygon: { x: number; y: number }[], p: { x: number; y: number }) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}
