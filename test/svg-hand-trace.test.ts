// @vitest-environment jsdom
import svgpath from "svgpath";
import { describe, expect, it } from "vitest";
import type { Design, Point2 } from "../src/core";
import { createHandTrace, type HandTrace } from "../src/handTrace";
import { designFromPathData } from "../src/input/pathDesign";
import { readSvgDesign } from "../src/input/svgDesign";
import { autoTraceShapes, readSvgHandTrace } from "../src/input/svgHandTrace";
import { expectSameOutlines, outlinesOf } from "./outlines";

/** An SVG file drawing `body`. */
const svgOf = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${body}</svg>`;

/** Edit as hand-trace on the SVG design in `text`: the hand-trace it lands on, on a 400 × 400 px canvas. */
function editAsHandTrace(text: string): HandTrace {
  const read = readSvgHandTrace(text);
  if (!read) throw new Error("no hand-trace");
  const editor = createHandTrace({ toDesign: designFromPathData, page: read.page, record: read.handTrace });
  editor.resize(400, 400);
  return editor;
}

describe("Edit as hand-trace on an SVG design", () => {
  it("lands on a page shaped to the design's box plus 10% of its long side all round", () => {
    // 200 × 100, so 20 all round: a page 240 × 140, one unit across.
    const editor = editAsHandTrace(svgOf('<rect x="50" y="30" width="200" height="100"/>'));
    expect(editor.page().width).toBeCloseTo(1, 12);
    expect(editor.page().height).toBeCloseTo(140 / 240, 12);
    const box = editor.design()!.bbox;
    expect(box.minX).toBeCloseTo(20 / 240, 6);
    expect(box.minY).toBeCloseTo(20 / 240, 6);
    expect(box.maxX).toBeCloseTo(220 / 240, 6);
    expect(box.maxY).toBeCloseTo(120 / 240, 6);
  });

  it("puts the symmetry axis down the middle of the design's box", () => {
    const editor = editAsHandTrace(svgOf('<rect x="50" y="30" width="200" height="100"/>'));
    const { page, axis } = editor.drawn();
    const { minX, maxX } = editor.design()!.bbox;
    const middle = page.x + (((minX + maxX) / 2) * page.width) / editor.page().width;
    expect(axis!.from.x).toBeCloseTo(middle, 3);
    expect(axis!.to.x).toBeCloseTo(middle, 3);
  });

  it.each([
    [
      "nested transforms",
      `<g transform="translate(100 50) scale(2)">
         <g transform="rotate(30)"><path transform="skewX(10)" d="M0 0C20-30 60-30 80 0L40 50Z"/></g>
         <rect transform="matrix(1 0.2 -0.3 1 5 5)" x="-40" y="10" width="30" height="20"/>
       </g>`,
    ],
    ["arcs and quadratics", '<path d="M10 80Q52 10 95 80T180 80A45 30 20 0 1 100 150a20 20 0 1 0-40 0Z"/>'],
    ["smooth cubics", '<path d="M20 100C20 40 80 40 100 100S180 160 180 100C180 40 20 160 20 100Z"/>'],
    [
      "a rect, a rounded rect, a circle and an ellipse",
      `<rect x="0" y="0" width="60" height="40"/><rect x="10" y="60" width="100" height="60" rx="12"/>
       <circle cx="200" cy="60" r="40"/><ellipse cx="160" cy="180" rx="80" ry="25" transform="rotate(-15 160 180)"/>`,
    ],
    [
      "several subpaths, holes and an open one",
      `<path d="M0 0H200V200H0ZM50 50V150H150V50ZM60 60L80 60L70 80"/>
       <polygon points="220 0 300 0 260 70"/><polyline points="220 100 300 100 300 180"/>`,
    ],
  ])("over %s, gives the Design the SVG design has", (_, body) => {
    const text = svgOf(body);
    const hand = editAsHandTrace(text).design()!;
    const loaded = readSvgDesign(text).design!;
    // Placement scales and centres the Design by its box, so the box is all a page moves.
    const { bbox } = loaded;
    const tolerance = (3 * TOL * Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)) / (bbox.maxX - bbox.minX);
    expectSameOutlines(inBox(hand), inBox(loaded), tolerance);
  });

  it("raises a quadratic to a cubic exactly", () => {
    // Its box is 100 × 50 (the curve peaks halfway up its control point), so 10 all round, 120 across.
    const quadratic = "M0 0Q50 100 100 0Z";
    const editor = editAsHandTrace(svgOf(`<path d="${quadratic}"/>`));
    // Path data is y down: the page's 60 high, less the 10 margin, is where the curve's top (y = 50) lands.
    const expected = svgpath(quadratic).translate(10, -60).scale(1 / 120).toString();
    const fine = 1e-6;
    expectSameOutlines(outlinesOf(editor.pathData(), fine), outlinesOf(expected, fine), 10 * fine);
  });

  it("makes a circle 4 smooth points", () => {
    const editor = editAsHandTrace(svgOf('<circle cx="50" cy="50" r="40"/>'));
    expect(editor.shapes().map((s) => s.points.map((p) => p.kind))).toEqual([["smooth", "smooth", "smooth", "smooth"]]);
  });

  it.each([
    // The top point's in handle points straight back along -x; its out handle rises by the given angle.
    ["in line", "smooth", "M0 0C0 50 50 100 100 100C150 100 200 50 200 0Z"],
    ["0.8° apart", "smooth", "M0 0C0 50 50 100 100 100C150 99.3 200 50 200 0Z"],
    ["2° apart", "corner", "M0 0C0 50 50 100 100 100C150 98.3 200 50 200 0Z"],
    ["at a cusp", "corner", "M0 0C0 50 50 100 100 100C50 50 200 50 200 0Z"],
  ])("makes a point between two curves whose tangents are %s a %s point", (_, kind, d) => {
    const [shape] = editAsHandTrace(svgOf(`<path d="${d}"/>`)).shapes();
    expect(shape.points.map((p) => p.kind)).toEqual(["corner", kind, "corner"]);
  });

  it("makes a point with a straight edge on one side a corner, keeping the curve's handle", () => {
    const [shape] = editAsHandTrace(svgOf('<path d="M0 0L100 0C100 50 50 100 0 100Z"/>')).shapes();
    expect(shape.points.map((p) => [p.kind, !!p.in, !!p.out])).toEqual([
      ["corner", false, false],
      ["corner", false, true],
      ["corner", true, false],
    ]);
  });

  it("keeps a lens drawn with two curves as a shape that looks the same", () => {
    const text = svgOf('<path d="M0 50C30 0 70 0 100 50C70 100 30 100 0 50Z"/>');
    const editor = editAsHandTrace(text);
    expect(editor.shapes()).toHaveLength(1);
    expect(editor.shapes()[0].points.length).toBeGreaterThanOrEqual(3);
    expectSameOutlines(inBox(editor.design()!), inBox(readSvgDesign(text).design!), 3 * TOL);
  });

  it("gives every shape mirror none and an id of its own, with nothing being drawn and nothing to undo", () => {
    const editor = editAsHandTrace(svgOf('<rect width="10" height="10"/><circle cx="30" cy="5" r="5"/>'));
    expect(editor.shapes().map((s) => s.mirror)).toEqual(["none", "none"]);
    expect(new Set(editor.shapes().map((s) => s.id)).size).toBe(2);
    expect(editor.record()).toMatchObject({ drawing: null, done: false });
    expect(editor.drawn().can.undo).toBe(false);
  });

  it("finds nothing to edit in an SVG with no shape that has an area", () => {
    expect(readSvgHandTrace(svgOf('<line x1="0" y1="0" x2="10" y2="10"/>'))).toBeNull();
    expect(readSvgHandTrace("not svg")).toBeNull();
  });
});

/**
 * Auto-trace's result over a cleaned-up photo 400 × 300 px, written as Potrace writes it: y up, at ten times the
 * pixel size, under one transform that puts it back.
 */
const potraceOf = (d: string) =>
  `<svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="400.000000pt" height="300.000000pt" ` +
  `viewBox="0 0 400.000000 300.000000"><g transform="translate(0.000000,300.000000) scale(0.100000,-0.100000)" ` +
  `fill="#000000" stroke="none"><path d="${d}"/></g></svg>`;
/** That photo as design space has it: one unit across, three quarters of one up. */
const PHOTO = { width: 400, height: 300 };

describe("Edit as hand-trace on the auto-trace result", () => {
  /** The copied shapes over the photo, on a 400 × 400 px canvas. */
  const copied = (svg: string) => {
    const editor = createHandTrace({ toDesign: designFromPathData, page: { width: 1, height: 0.75 }, photo: true });
    editor.resize(400, 400);
    editor.replace(autoTraceShapes(svg, PHOTO));
    return editor;
  };

  it("lands each shape where it is on the photo: nothing moves", () => {
    // Pixels 100–300 across and 75–225 down (y down): in design space 0.25–0.75 across and 0.1875–0.5625 up.
    const editor = copied(potraceOf("M1000 2250 L3000 2250 L3000 750 L1000 750 Z"));
    const square = [
      { x: 0.25, y: 0.5625 },
      { x: 0.75, y: 0.5625 },
      { x: 0.75, y: 0.1875 },
      { x: 0.25, y: 0.1875 },
    ];
    expectSameOutlines(editor.design()!.paths, [square], TOL);
  });

  it("keeps Potrace's curves and holes, its Design the result's own", () => {
    const svg = potraceOf("M2000 2800 c600 0 1000 -400 1000 -1000 c0 -600 -400 -1000 -1000 -1000 c-600 0 -1000 400 -1000 1000 c0 600 400 1000 1000 1000z m0 -600 l-300 -400 300 -400 300 400z");
    const editor = copied(svg);
    // The loader reads the result in pixels, y up from the top edge: a pixel (u, -v) is (u / 400, (300 - v) / 400).
    const result = readSvgDesign(svg).design!.paths.map((p) => p.map(({ x, y }) => ({ x: x / 400, y: (300 + y) / 400 })));
    expectSameOutlines(editor.design()!.paths, result, TOL);
    expect(editor.shapes().map((s) => [s.closed, s.mirror, s.points.length])).toEqual([
      [true, "none", 4],
      [true, "none", 4],
    ]);
  });
});

/** The loader's tolerance, as a fraction of a design's long side. */
const TOL = 5e-4;

/** A Design's paths measured from its box's corner, in its box's widths: as placing it sees them. */
function inBox({ paths, bbox }: Design): Point2[][] {
  const across = bbox.maxX - bbox.minX;
  return paths.map((p) => p.map(({ x, y }) => ({ x: (x - bbox.minX) / across, y: (y - bbox.minY) / across })));
}
