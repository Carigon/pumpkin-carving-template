import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildTemplate, defaultMargin, type Placement, type PumpkinMeasurements, type SlitOptions } from "../src/core";
import { layoutTemplatePdf, type Mark } from "../src/pdf/layout";
import { renderPdf } from "../src/pdf/render";

/** mm per inch: the template is in mm, the info block in the carver's display units. */
const IN = 25.4;
const measurements: PumpkinMeasurements = { height: 1000 * IN, rings: [{ circumference: 2000 * IN, position: 0.5 }] };
const placement: Placement = { width: 4 * IN, verticalOffset: 0, rotation: 0 };
const result = buildTemplate({
  measurements,
  design: { paths: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]], bbox: { minX: 0, minY: 0, maxX: 4, maxY: 2 } },
  placement,
});
const input = {
  template: result.template!,
  surface: result.surface!,
  measurements,
  placement,
  slits: { count: "auto", depth: 2 * IN } satisfies SlitOptions,
  units: "in" as const,
};
/** The same template with two slits drawn in (the solid design leaves no room for real ones). */
const slitted = {
  ...input.template,
  slits: [
    [{ x: 0, y: 2 * IN }, { x: 0, y: 1.5 * IN }, { x: 0.01 * IN, y: 2 * IN }],
    [{ x: 0, y: -2 * IN }, { x: 0, y: -1.5 * IN }, { x: 0.01 * IN, y: -2 * IN }],
  ],
};

function bbox(mark: Mark) {
  const pts = mark.kind === "path" ? mark.subpaths.flat() : [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
const find = (marks: Mark[], role: Mark["role"]) => marks.filter((m) => m.role === role);

describe("PDF layout", () => {
  it("draws the template at true scale (25.4 mm = 72 pt) on one Letter page", () => {
    const layout = layoutTemplatePdf(input);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].size).toEqual([612, 792]);
    const [design] = find(layout.pages[0].marks, "design");
    expect(bbox(design).width).toBeCloseTo(4 * 72, 0);
    const [cut] = find(layout.pages[0].marks, "cut-outline");
    // The design and the default margin either side.
    expect(bbox(cut).width).toBeCloseTo(((4 * IN + 2 * defaultMargin()) / IN) * 72, 0);
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

  it("lists the height and every ring, with its height above the table, in the info block", () => {
    const ringed: PumpkinMeasurements = {
      ...measurements,
      rings: [{ position: 0.5, circumference: 2000 * IN }, { position: 0.75, circumference: 1400 * IN }, { position: 0.25, circumference: 1500 * IN }],
    };
    const info = find(layoutTemplatePdf({ ...input, measurements: ringed }).pages[0].marks, "info")
      .map((m) => (m.kind === "text" ? m.text : ""))
      .join("\n");

    expect(info).toContain("Height: 1000 in");
    expect(info).toContain("Ring: 2000 in @ 500 in above the table");
    expect(info).toContain("Ring: 1400 in @ 750 in above the table");
    expect(info).toContain("Ring: 1500 in @ 250 in above the table");
    expect(info).not.toMatch(/arc|depth:/i);
  });

  it("prints the info block's lengths in the carver's display units, from the same mm template", () => {
    const text = (units: "in" | "cm") =>
      find(layoutTemplatePdf({ ...input, template: slitted, units, cut: { margin: 19.05, line: true } }).pages[0].marks, "info").map((m) =>
        m.kind === "text" ? m.text : "",
      );

    expect(text("in")).toContain("Height: 1000 in");
    expect(text("in")).toContain("Cut-out margin: 0.75 in, cut line printed");
    expect(text("in")).toContain("Design width seen from the front: 4 in");
    expect(text("cm")).toContain("Height: 2540 cm");
    expect(text("cm")).toContain("Cut-out margin: 1.9 cm, cut line printed");
    expect(text("cm")).toContain("Design width seen from the front: 10.2 cm");
    expect(text("cm")).toContain("Slits: 2 (auto), up to 5.1 cm deep");
    expect(text("cm").join("\n")).not.toMatch(/\d in\b/);
  });

  it("with many rings, the info block stays on the page, clear of the check square and the template", () => {
    const rings = Array.from({ length: 10 }, (_, i) => ({ position: 0.05 + 0.09 * i, circumference: (1500 + 10.25 * i) * IN }));
    const ringed: PumpkinMeasurements = { ...measurements, rings };
    for (const paper of ["letter", "a4"] as const) {
      const layout = layoutTemplatePdf({ ...input, measurements: ringed, paper });
      const [pageW] = layout.pages[0].size;
      const marks = layout.pages.flatMap((p) => p.marks);
      const info = find(marks, "info").filter((m): m is Extract<Mark, { kind: "text" }> => m.kind === "text");
      const [square] = find(marks, "check-square").filter((m) => m.kind === "path");
      const sq = square.kind === "path" ? square.subpaths.flat() : [];
      const squareRight = Math.max(...sq.map((p) => p.x));
      const squareBottom = Math.min(...sq.map((p) => p.y));
      const template = [...find(marks, "cut-outline"), ...find(marks, "design")].flatMap((m) => (m.kind === "path" ? m.subpaths.flat() : []));
      const templateBottom = Math.min(...template.map((p) => p.y));

      expect(info.map((m) => m.text).join("\n")).toContain("1592.25 in");
      for (const m of info) {
        // Beside the square, never over it; on the page (18 pt margins); below the template.
        expect(m.x).toBeGreaterThan(squareRight);
        expect(m.y).toBeGreaterThanOrEqual(Math.max(18, squareBottom));
        expect(m.x + m.text.length * m.size * 0.55).toBeLessThanOrEqual(pageW - 18);
        expect(m.y + m.size).toBeLessThan(templateBottom);
      }
    }
  });

  it("names the slits in the info block and says to cut the dashed slits", () => {
    const info = (slits: SlitOptions, template = slitted) =>
      find(layoutTemplatePdf({ ...input, template, slits }).pages[0].marks, "info").map((m) => (m.kind === "text" ? m.text : ""));

    expect(info({ count: 2, depth: IN })).toContain("Slits: 2, up to 1 in deep");
    expect(info({ count: "auto", depth: 2 * IN })).toContain("Slits: 2 (auto), up to 2 in deep");
    expect(info({ count: "auto", depth: 2 * IN })).toContain("Cut along the solid line and the dashed slits.");
    expect(info({ count: "auto", depth: 2 * IN }, input.template)).toContain("Slits: none");
    expect(info({ count: "auto", depth: 2 * IN }, input.template)).toContain("Cut along the solid line.");
  });

  it("names the cut-out margin and prints the solid cut-out edge by default", () => {
    const { marks } = layoutTemplatePdf({ ...input, cut: { margin: 0.75 * IN, line: true } }).pages[0];
    const info = find(marks, "info").map((m) => (m.kind === "text" ? m.text : ""));

    expect(find(marks, "cut-outline")).toHaveLength(1);
    expect(info).toContain("Cut-out margin: 0.75 in, cut line printed");
  });

  it("leaves out the solid cut-out edge when the cut line is turned off, and says so", () => {
    const layout = layoutTemplatePdf({ ...input, template: slitted, cut: { margin: 0.75 * IN, line: false } });
    const { marks } = layout.pages[0];
    const info = find(marks, "info").map((m) => (m.kind === "text" ? m.text : ""));

    expect(layout.pages).toHaveLength(1);
    expect(find(marks, "cut-outline")).toHaveLength(0);
    // Everything else is still there.
    expect(find(marks, "design")).toHaveLength(1);
    expect(find(marks, "slit")).toHaveLength(1);
    expect(find(marks, "center-cross")).not.toHaveLength(0);
    expect(find(marks, "stem-arrow")).not.toHaveLength(0);
    expect(info).toContain("Cut-out margin: 0.75 in, cut line not printed");
    expect(info.join("\n")).not.toContain("solid line");
  });

  it("outlines carve areas by default and fills them on request", () => {
    const [outlined] = find(layoutTemplatePdf(input).pages[0].marks, "design");
    const [filled] = find(layoutTemplatePdf({ ...input, filled: true }).pages[0].marks, "design");

    expect(outlined).not.toHaveProperty("fill");
    expect(filled).toMatchObject({ fill: "even-odd" });
  });

  it("draws the slits as dashed lines", () => {
    const slits = [[{ x: 0, y: 2 * IN }, { x: 0, y: 1.5 * IN }, { x: 0.01 * IN, y: 2 * IN }]];
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

function bigInput(widthIn: number) {
  const placement: Placement = { width: widthIn * IN, verticalOffset: 0, rotation: 0 };
  const big = buildTemplate({
    measurements,
    design: { paths: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]], bbox: { minX: 0, minY: 0, maxX: 4, maxY: 3 } },
    placement,
  });
  return {
    template: big.template!,
    surface: big.surface!,
    measurements,
    placement,
    slits: { count: "auto", depth: 2 * IN } satisfies SlitOptions,
    units: "in" as const,
  };
}

/** Where the template's origin (design center) sits on a page: the middle of its center cross. */
function originOn(marks: Mark[]) {
  const [cross] = find(marks, "center-cross");
  if (!cross || cross.kind !== "path") return null;
  const [h, v] = cross.subpaths;
  return { x: (h[0].x + h[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
}
const clipOf = (marks: Mark[]) => find(marks, "cut-outline")[0]?.clip;

describe("PDF tiling", () => {
  const big = bigInput(16); // ~17.5 x 13 in: too big for one Letter page

  it("splits a template bigger than a page across several pages of the chosen paper", () => {
    const layout = layoutTemplatePdf({ ...big, paper: "a4" });
    const tiles = layout.pages.filter((p) => find(p.marks, "cut-outline").length > 0);

    expect(tiles.length).toBeGreaterThan(1);
    for (const page of layout.pages) expect(page.size).toEqual([595.28, 841.89]);
  });

  it("keeps true scale on every tile and clips each tile to the printable area", () => {
    const layout = layoutTemplatePdf(big);
    const tiles = layout.pages.filter((p) => find(p.marks, "cut-outline").length > 0);

    for (const page of tiles) {
      const [design] = find(page.marks, "design");
      expect(bbox(design).width).toBeCloseTo(16 * 72, 0);
      const clip = clipOf(page.marks)!;
      expect(clip.x).toBeGreaterThanOrEqual(0);
      expect(clip.y).toBeGreaterThanOrEqual(0);
      expect(clip.x + clip.width).toBeLessThanOrEqual(612);
      expect(clip.y + clip.height).toBeLessThanOrEqual(792);
    }
  });

  it("covers the whole template, with neighbouring tiles overlapping by at least a quarter inch", () => {
    const layout = layoutTemplatePdf(big);
    const tiles = layout.pages.filter((p) => find(p.marks, "cut-outline").length > 0);
    // Each tile's printable area, in template coordinates (pt from the design center).
    const regions = tiles.map((p) => {
      const o = originOn(p.marks)!;
      const c = clipOf(p.marks)!;
      return { minX: c.x - o.x, maxX: c.x + c.width - o.x, minY: c.y - o.y, maxY: c.y + c.height - o.y };
    });
    const [cut] = find(tiles[0].marks, "cut-outline");
    const o0 = originOn(tiles[0].marks)!;
    const pts = cut.kind === "path" ? cut.subpaths[0].map((p) => ({ x: p.x - o0.x, y: p.y - o0.y })) : [];

    for (const p of pts) {
      expect(regions.some((r) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY)).toBe(true);
    }
    // Horizontal neighbours share a band at least 18 pt wide.
    const sameRow = regions.filter((r) => Math.abs(r.maxY - regions[0].maxY) < 1e-6).sort((a, b) => a.minX - b.minX);
    expect(sameRow.length).toBeGreaterThan(1);
    expect(sameRow[0].maxX - sameRow[1].minX).toBeGreaterThanOrEqual(18);
  });
});

describe("PDF tiling join marks", () => {
  const big = bigInput(16);
  const layout = layoutTemplatePdf(big);
  const tiles = layout.pages.filter((p) => find(p.marks, "cut-outline").length > 0);

  /** Centers of a page's solid join-mark strokes inside its printable area, in template coordinates. */
  function joinPoints(marks: Mark[]) {
    const o = originOn(marks)!;
    const c = clipOf(marks)!;
    return find(marks, "join")
      .flatMap((m) => (m.kind === "path" && !m.stroke?.dash ? m.subpaths : []))
      .map((sub) => ({ x: (sub[0].x + sub[1].x) / 2, y: (sub[0].y + sub[1].y) / 2 }))
      .filter((p) => p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height)
      .map((p) => `${Math.round(p.x - o.x)},${Math.round(p.y - o.y)}`);
  }

  it("prints alignment crosses that land on the same template spot on both neighbouring pages", () => {
    const [a, b] = tiles; // first row: A1 and B1
    const shared = joinPoints(a.marks).filter((p) => joinPoints(b.marks).includes(p));

    expect(shared.length).toBeGreaterThanOrEqual(2);
  });

  it("labels each tile and the neighbours it joins", () => {
    const text = (marks: Mark[]) => find(marks, "join").map((m) => (m.kind === "text" ? m.text : "")).join("\n");

    expect(text(tiles[0].marks)).toContain("A1");
    expect(text(tiles[0].marks)).toContain("joins B1");
    expect(text(tiles[1].marks)).toContain("joins A1");
    expect(layout.tiles.rows * layout.tiles.cols).toBe(tiles.length);
  });

  it("still includes the 10 cm check square and info block, and renders every page", async () => {
    const marks = layout.pages.flatMap((p) => p.marks);
    const [square] = find(marks, "check-square");
    expect(bbox(square).width).toBeCloseTo((100 / 25.4) * 72, 3);
    expect(find(marks, "info")).not.toHaveLength(0);

    const doc = await PDFDocument.load(await renderPdf(layout));
    expect(doc.getPageCount()).toBe(layout.pages.length);
  });
});
