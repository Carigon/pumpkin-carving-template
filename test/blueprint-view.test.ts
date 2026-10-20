import { describe, expect, it } from "vitest";
import { fitProfile, ringAt, type PumpkinMeasurements, type Units } from "../src/core";
import { blueprintView, describeSelection, fitScale, OVERHANG, type BlueprintDrawing, type GapRef } from "../src/blueprintView";
import { tapeLength } from "../src/displayUnits";
import { ballMeasurements } from "../src/input/calibrationGrid";

/** mm per inch. */
const IN = 25.4;
const pumpkin: PumpkinMeasurements = {
  height: 9 * IN,
  rings: [{ position: 0.4, circumference: 32 * IN }, { position: 0.8, circumference: 22 * IN }],
};
const size = { width: 800, height: 600 };

/** The Blueprint view of `measurements` in a view of `size` px, through the public `fitProfile`. */
function draw(
  measurements: PumpkinMeasurements = pumpkin,
  options: {
    zoom?: number;
    units?: Units;
    ball?: boolean;
    size?: { width: number; height: number };
    blame?: number | null;
    readout?: number | "height";
    selected?: number | "height" | null;
    hovered?: number | GapRef | null;
  } = {},
): BlueprintDrawing {
  return blueprintView({
    measurements,
    fit: fitProfile(measurements),
    ball: options.ball ?? false,
    zoom: options.zoom ?? 1,
    size: options.size ?? size,
    units: options.units ?? "in",
    blame: options.blame,
    readout: options.readout,
    selected: options.selected,
    hovered: options.hovered,
  });
}

describe("Blueprint view geometry", () => {
  it("at 1x fits the whole pumpkin, its ring handles and the height line inside the view with a margin", () => {
    for (const view of [size, { width: 500, height: 900 }]) {
      const drawing = draw(pumpkin, { size: view });
      const pts = [
        ...drawing.profile!.right,
        ...drawing.profile!.left,
        ...drawing.rings.flatMap((r) => [{ x: r.x1, y: r.y }, { x: r.handle.x + 14, y: r.y }]),
        { x: drawing.height!.handle.x + 14, y: drawing.height!.y },
      ];
      const box = bbox(pts);
      expect(box.minX).toBeGreaterThan(0);
      expect(box.maxX).toBeLessThan(view.width);
      expect(box.minY).toBeGreaterThanOrEqual(40);
      expect(box.maxY).toBeLessThan(view.height);
      // Fitted, not merely inside: it fills the view up to the top margin, or across to the right margin (as
      // wide as the ruler and label column on the left, keeping the pumpkin centred), whichever runs out first.
      const fillsUp = box.minY < 60;
      const fillsAcross = box.maxX > view.width - 150;
      expect(fillsUp || fillsAcross).toBe(true);
    }
  });

  it("in a narrow view still draws the pumpkin a usable size, letting the labels run over it", () => {
    const narrow = { width: 375, height: 281 };
    const drawing = draw(pumpkin, { size: narrow });
    const box = bbox([...drawing.profile!.right, ...drawing.profile!.left]);
    expect(box.maxX - box.minX).toBeGreaterThan(narrow.width / 4);
    const widest = drawing.rings.find((r) => r.index === 0)!;
    expect(widest.handle.x + 14).toBeLessThan(narrow.width);
    expect(widest.x1).toBeGreaterThan(drawing.ruler.x);
  });

  it("zooms out to a quarter at most and never in past the fit", () => {
    const fit = draw().scale;
    expect(draw(pumpkin, { zoom: 0.5 }).scale).toBeCloseTo(fit / 2, 9);
    expect(draw(pumpkin, { zoom: 0.1 }).zoom).toBe(0.25);
    expect(draw(pumpkin, { zoom: 0.1 }).scale).toBeCloseTo(fit / 4, 9);
    expect(draw(pumpkin, { zoom: 3 }).zoom).toBe(1);
    expect(draw(pumpkin, { zoom: 3 }).scale).toBeCloseTo(fit, 9);
  });

  it("zooms about the bottom middle: the table stays put and the pumpkin shrinks toward it", () => {
    const whole = draw();
    const half = draw(pumpkin, { zoom: 0.5 });
    expect(half.origin).toEqual({ x: size.width / 2, y: whole.origin.y });
    const base = whole.profile!.right.at(-1)!;
    expect(half.profile!.right.at(-1)!.y).toBeCloseTo(base.y, 6);
    for (const [i, ring] of whole.rings.entries()) {
      const zoomed = half.rings[i];
      expect(whole.origin.y - zoomed.y).toBeCloseTo((whole.origin.y - ring.y) / 2, 6);
      expect(zoomed.x2 - OVERHANG - size.width / 2).toBeCloseTo((ring.x2 - OVERHANG - size.width / 2) / 2, 6);
    }
  });

  it("holds a given 1x scale whatever the measurements, so the drawing can stay still under a drag", () => {
    const held = fitScale({ measurements: pumpkin, fit: fitProfile(pumpkin), size, units: "in" });
    expect(held).toBeCloseTo(draw().scale, 9);
    const taller = { ...pumpkin, height: 14 * IN };
    const drawing = blueprintView({ measurements: taller, fit: fitProfile(taller), ball: false, zoom: 0.5, size, units: "in", fitScale: held });
    expect(drawing.scale).toBeCloseTo(held / 2, 9);
    expect(drawing.origin.y - drawing.height!.y).toBeCloseTo(14 * IN * (held / 2), 6);
  });

  it("labels the ruler in the display units from 0 at the table up to the height rounded up", () => {
    const inches = draw().ruler;
    expect(inches.labels.map((l) => l.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(inches.units?.text).toBe("in");
    const drawing = draw();
    expect(inches.labels[0].y).toBeCloseTo(drawing.origin.y, 6);
    // 9 in up, at true scale.
    expect(drawing.origin.y - inches.labels[9].y).toBeCloseTo(9 * IN * drawing.scale, 6);

    // 22.86 cm: labelled every 2 cm at this size, up to 22 (the last step at or below 23).
    const cm = draw(pumpkin, { units: "cm" }).ruler;
    const values = cm.labels.map((l) => Number(l.text));
    expect(values[0]).toBe(0);
    const step = values[1];
    expect(values).toEqual(values.map((_, i) => i * step));
    expect(values.at(-1)!).toBeLessThanOrEqual(23);
    expect(values.at(-1)! + step).toBeGreaterThan(23);
    expect(cm.units?.text).toBe("cm");
  });

  it("zoomed out, the ruler's ticks run on up the view past the last label", () => {
    const drawing = draw(pumpkin, { zoom: 0.25 });
    const { ticks, labels } = drawing.ruler;
    // Labelled more sparsely now, but still not past 9 in.
    expect(Number(labels.at(-1)!.text)).toBeLessThanOrEqual(9);
    expect(Number(labels.at(-1)!.text)).toBeGreaterThan(9 - Number(labels[1].text));
    const top = Math.min(...ticks.map((t) => t.y));
    expect(top).toBeLessThan(labels.at(-1)!.y - 100);
    expect(top).toBeGreaterThanOrEqual(0);
    // Up to within one tick spacing of the top of the view.
    const spacing = ticks[0].y - ticks[1].y;
    expect(top).toBeLessThan(spacing + 1e-6);
  });

  it("draws the fitted profile at true scale on both sides, from the stem down to the table", () => {
    const drawing = draw();
    const { right, left, rough } = drawing.profile!;
    const { origin, scale } = drawing;
    expect(rough).toBe(false);
    expect(left).toHaveLength(right.length);
    right.forEach((p, i) => {
      expect(left[i].x - origin.x).toBeCloseTo(origin.x - p.x, 9);
      expect(left[i].y).toBeCloseTo(p.y, 9);
    });
    // Stem at the top, base on the table, both on the axis.
    expect(right[0].y).toBeCloseTo(origin.y - 9 * IN * scale, 6);
    expect(right.at(-1)!.y).toBeCloseTo(origin.y, 6);
    expect(right[0].x).toBeCloseTo(origin.x, 0);
    expect(right.at(-1)!.x).toBeCloseTo(origin.x, 0);
    // Widest at the 32 in ring, 0.4 of the way up: true scale, same as the fit.
    const fit = fitProfile(pumpkin);
    if (!fit.ok) throw new Error("expected a fit");
    const widest = right.reduce((a, b) => (b.x > a.x ? b : a));
    expect((widest.x - origin.x) / scale).toBeCloseTo((32 * IN) / (2 * Math.PI), 0);
    expect((origin.y - widest.y) / scale / (9 * IN)).toBeCloseTo(0.4, 1);
    for (const p of right) {
      const position = (origin.y - p.y) / scale / (9 * IN);
      expect((p.x - origin.x) / scale).toBeCloseTo(fit.radiusAt(position), 0);
    }
  });

  it("runs each ring's line 14 px past the profile on both sides, with its handle at the right end", () => {
    const drawing = draw();
    const { origin, scale } = drawing;
    expect(drawing.rings.map((r) => r.index)).toEqual([1, 0]);
    for (const ring of drawing.rings) {
      const { circumference, position } = pumpkin.rings[ring.index];
      const radius = (circumference / (2 * Math.PI)) * scale;
      expect(ring.y).toBeCloseTo(origin.y - position * 9 * IN * scale, 6);
      expect(ring.x2 - origin.x).toBeCloseTo(radius + 14, 6);
      expect(origin.x - ring.x1).toBeCloseTo(radius + 14, 6);
      expect(ring.handle.y).toBe(ring.y);
      expect(ring.handle.x).toBeGreaterThan(ring.x2);
      expect(ring.handle.x - ring.x2).toBeLessThan(30);
    }
  });

  it("labels each ring by the ruler with its circumference and height above the table, to the nearest ⅛ in or 0.1 cm", () => {
    const inches = draw().rings;
    expect(inches.map((r) => [r.label.text, r.label.at])).toEqual([
      ["22 in", "at 7 ¼ in"],
      ["32 in", "at 3 ⅝ in"],
    ]);
    expect(draw(pumpkin, { units: "cm" }).rings.map((r) => [r.label.text, r.label.at])).toEqual([
      ["55.9 cm", "at 18.3 cm"],
      ["81.3 cm", "at 9.1 cm"],
    ]);
    const { ruler } = draw();
    for (const ring of inches) {
      expect(ring.label.x).toBeGreaterThan(ruler.x);
      expect(ring.label.x).toBeLessThan(ring.x1);
      expect(ring.label.y).toBeLessThan(ring.y);
      expect(ring.label.leader).toEqual({ x1: ruler.x, x2: ring.x1, y: ring.y });
    }
  });

  it("draws the height line across the top from the ruler, its handle in line with the widest ring's", () => {
    const drawing = draw();
    const line = drawing.height!;
    expect(line.y).toBeCloseTo(drawing.origin.y - 9 * IN * drawing.scale, 6);
    expect(line.x1).toBe(drawing.ruler.x);
    const widest = drawing.rings.find((r) => r.index === 0)!;
    expect(line.handle.x).toBeCloseTo(widest.handle.x, 9);
    expect(line.handle.y).toBe(line.y);
    expect(line.label.text).toBe("height 9 in");
    expect(draw(pumpkin, { units: "cm" }).height!.label.text).toBe("height 22.9 cm");
  });

  it("when no smooth shape fits, draws a dashed rough profile straight through the rings and says so", () => {
    expect(fitProfile(noShape).ok).toBe(false);
    const drawing = draw(noShape);
    const { origin, scale } = drawing;
    const { right, left, rough } = drawing.profile!;
    expect(rough).toBe(true);
    const up = (mm: number) => origin.y - mm * scale;
    const out = (mm: number) => origin.x + mm * scale;
    const r = (inches: number) => (inches * IN) / (2 * Math.PI);
    const expected = [
      { x: origin.x, y: up(9 * IN) },
      { x: out(r(12)), y: up(0.452 * 9 * IN) },
      { x: out(r(30)), y: up(0.45 * 9 * IN) },
      { x: out(r(25)), y: up(0.25 * 9 * IN) },
      { x: origin.x, y: up(0) },
    ];
    expect(right).toHaveLength(expected.length);
    right.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 6);
      expect(p.y).toBeCloseTo(expected[i].y, 6);
      expect(left[i].x).toBeCloseTo(2 * origin.x - expected[i].x, 6);
    });
    expect(drawing.banner).toMatch(/^No smooth pumpkin shape passes through these rings\./);
    // The rings and height still show, to edit.
    expect(drawing.rings).toHaveLength(3);
    expect(drawing.height).not.toBeNull();
  });

  it("names the ring edited last by its height in a failed fit's banner", () => {
    const blamed = draw(noShape, { blame: 2 });
    expect(blamed.banner).toMatch(/^No smooth pumpkin shape passes through the ring at 4 ⅛ in\. /);
    expect(draw(noShape, { blame: 0, units: "cm" }).banner).toMatch(/through the ring at 5\.7 cm\. /);
    // On a page load nothing has been edited yet, and a ring that's gone can't be named.
    expect(draw(noShape, { blame: null }).banner).toMatch(/through these rings\./);
    expect(draw(noShape, { blame: 5 }).banner).toMatch(/through these rings\./);
    expect(draw(pumpkin, { blame: 0 }).banner).toBeNull();
  });

  it("while a handle is dragged, labels its value to 0.1 as the readout", () => {
    const ring = draw(pumpkin, { readout: 1 }).rings;
    expect(ring.map((r) => [r.label.text, r.label.at])).toEqual([
      ["22.0 in", "at 7.2 in"],
      ["32 in", "at 3 ⅝ in"],
    ]);
    expect(draw(pumpkin, { readout: 1 }).height!.label.text).toBe("height 9 in");
    expect(draw(pumpkin, { readout: "height", units: "cm" }).height!.label.text).toBe("height 22.9 cm");
    expect(draw({ ...pumpkin, height: 9.06 * IN }, { readout: "height" }).height!.label.text).toBe("height 9.1 in");
    const ball = draw(ballMeasurements(30.3 * IN), { ball: true, readout: 0 });
    expect(ball.rings[0].label.text).toBe("30.3 in");
  });

  it("draws the profile, with no banner, when it fits", () => {
    expect(draw().banner).toBeNull();
  });

  it("leaves a ring that isn't measured yet out of the rough profile", () => {
    const halfTyped = { ...pumpkin, rings: [...pumpkin.rings, { position: 0.6, circumference: Number.NaN }] };
    const drawing = draw(halfTyped);
    expect(drawing.profile!.rough).toBe(true);
    expect(drawing.profile!.right).toHaveLength(4);
    expect(drawing.rings.map((r) => r.index)).toEqual([1, 0]);
    // The form already says what's wrong with that ring; the view doesn't blame the shape for it.
    expect(drawing.banner).not.toMatch(/No smooth pumpkin shape/);
  });

  it.each([Number.NaN, 0, -3 * IN])("with no valid height (%s) draws only an unlabelled ruler", (height) => {
    for (const units of ["in", "cm"] as const) {
      const drawing = draw({ ...pumpkin, height }, { units });
      expect(drawing.ruler.ticks.length).toBeGreaterThan(5);
      expect(drawing.ruler.labels).toEqual([]);
      expect(drawing.ruler.units).toBeNull();
      expect(drawing.profile).toBeNull();
      expect(drawing.rings).toEqual([]);
      expect(drawing.height).toBeNull();
      expect(drawing.banner).toBeNull();
      expect(Number.isFinite(drawing.scale) && drawing.scale > 0).toBe(true);
    }
  });

  it("in test-grid mode draws the ball as a circle with one handle and its circumference alone", () => {
    const ball = ballMeasurements(30 * IN);
    const drawing = draw(ball, { ball: true });
    const { origin, scale } = drawing;
    const radius = (30 * IN) / (2 * Math.PI);
    expect(drawing.circle!.cx).toBe(origin.x);
    expect(drawing.circle!.cy).toBeCloseTo(origin.y - radius * scale, 6);
    expect(drawing.circle!.r).toBeCloseTo(radius * scale, 6);
    expect(drawing.profile).toBeNull();
    expect(drawing.height).toBeNull();
    expect(drawing.rings).toHaveLength(1);
    const [ring] = drawing.rings;
    expect(ring.y).toBeCloseTo(drawing.circle!.cy, 6);
    expect(ring.x2 - origin.x).toBeCloseTo(radius * scale + 14, 6);
    expect(ring.handle.x).toBeGreaterThan(ring.x2);
    expect(ring.label.text).toBe("30 in");
    expect(ring.label.at).toBeNull();
    // 30 in around is 9.55 in across: the ruler runs to 10.
    expect(drawing.ruler.labels.map((l) => l.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  it("in test-grid mode with no circumference yet draws only an unlabelled ruler", () => {
    const drawing = draw(ballMeasurements(Number.NaN), { ball: true });
    expect(drawing.circle).toBeNull();
    expect(drawing.rings).toEqual([]);
    expect(drawing.ruler.labels).toEqual([]);
  });

  it("draws no circle for a pumpkin", () => {
    expect(draw().circle).toBeNull();
  });

  it("bounds each gap's band by the neighbouring rings, the height and the table, never the view's edge", () => {
    const drawing = draw();
    const [upper, lower] = drawing.rings; // the 22 in ring (index 1) at 0.8, the 32 in ring (index 0) at 0.4
    expect(drawing.gaps.map((g) => [g.above, g.below])).toEqual([
      [null, 1],
      [1, 0],
      [0, null],
    ]);
    const bands = drawing.gaps.map((g) => [g.band.y1, g.band.y2]);
    expect(bands[0][0]).toBeCloseTo(drawing.height!.y, 9);
    expect(bands[0][1]).toBeCloseTo(upper.y, 9);
    expect(bands[1]).toEqual([upper.y, lower.y]);
    expect(bands[2][0]).toBeCloseTo(lower.y, 9);
    expect(bands[2][1]).toBeCloseTo(drawing.origin.y, 9);
    // Across the pumpkin at its widest, as far as the ring lines run.
    for (const { band } of drawing.gaps) {
      expect(band.x1).toBeCloseTo(lower.x1, 6);
      expect(band.x2).toBeCloseTo(lower.x2, 6);
    }
    // Zoomed out, the bands still stop at the height and the table.
    const out = draw(pumpkin, { zoom: 0.25 });
    expect(out.gaps[0].band.y1).toBeCloseTo(out.height!.y, 9);
    expect(out.gaps[0].band.y1).toBeGreaterThan(100);
  });

  it("offers no gap too narrow for a ring, and none once there are 20 rings", () => {
    // 200 mm tall: rings 9 mm apart leave no room; 10 mm does.
    const close = { height: 200, rings: [{ position: 0.5, circumference: 500 }, { position: 0.545, circumference: 480 }] };
    expect(draw(close).gaps.map((g) => [g.above, g.below])).toEqual([
      [null, 1],
      [0, null],
    ]);
    const full = { height: 600, rings: Array.from({ length: 20 }, (_, i) => ({ position: (i + 1) / 21, circumference: 500 })) };
    expect(draw(full).gaps).toEqual([]);
    expect(draw(ballMeasurements(30 * IN), { ball: true }).gaps).toEqual([]);
  });

  it("over a hovered gap, draws a ghost ring at its middle with the circumference the shape has there, labelled like a ring", () => {
    expect(draw().ghost).toBeNull();
    const drawing = draw(pumpkin, { hovered: { above: 1, below: 0 } });
    const { origin, scale } = drawing;
    const ghost = drawing.ghost!;
    expect(ghost.gap).toEqual({ above: 1, below: 0 });
    // Midway between 0.8 and 0.4 of 9 in: 5.4 in up, labelled to the nearest ⅛.
    expect(ghost.y).toBeCloseTo(origin.y - 0.6 * 9 * IN * scale, 6);
    expect(ghost.label.at).toBe("at 5 ⅜ in");
    const around = ringAt(pumpkin, 0.6);
    expect(ghost.label.text).toBe(tapeLength(around, "in"));
    expect(ghost.x2 - origin.x).toBeCloseTo((around / (2 * Math.PI)) * scale + OVERHANG, 6);
    expect(origin.x - ghost.x1).toBeCloseTo(ghost.x2 - origin.x, 6);
    expect(ghost.plus).toEqual({ x: origin.x, y: ghost.y });
    expect(ghost.label.leader).toEqual({ x1: drawing.ruler.x, x2: ghost.x1, y: ghost.y });
    // A gap that isn't offered gets no ghost.
    expect(draw(pumpkin, { hovered: { above: 0, below: 1 } }).ghost).toBeNull();
  });

  it("marks the selected ring, with a × at its middle unless it's the last ring", () => {
    const drawing = draw(pumpkin, { selected: 0 });
    const selected = drawing.rings.find((r) => r.index === 0)!;
    const other = drawing.rings.find((r) => r.index === 1)!;
    expect(selected.selected).toBe(true);
    expect(selected.remove).toEqual({ x: drawing.origin.x, y: selected.y });
    expect(other.selected).toBe(false);
    expect(other.remove).toBeNull();
    expect(drawing.height!.selected).toBe(false);

    const one = { height: 9 * IN, rings: [pumpkin.rings[0]] };
    const last = draw(one, { selected: 0 }).rings[0];
    expect(last.selected).toBe(true);
    expect(last.remove).toBeNull();

    const height = draw(pumpkin, { selected: "height" });
    expect(height.height!.selected).toBe(true);
    expect(height.rings.every((r) => !r.selected && r.remove === null)).toBe(true);
  });

  it("marks the hovered ring", () => {
    const drawing = draw(pumpkin, { hovered: 1 });
    expect(drawing.rings.map((r) => [r.index, r.hovered])).toEqual([
      [1, true],
      [0, false],
    ]);
  });

  it("selects nothing on a ball", () => {
    const drawing = draw(ballMeasurements(30 * IN), { ball: true, selected: 0, hovered: 0 });
    expect(drawing.rings[0].selected).toBe(false);
    expect(drawing.rings[0].remove).toBeNull();
    expect(drawing.ghost).toBeNull();
  });

  it("describes the selection for a screen reader: a ring's height, circumference and place top to bottom, or the height", () => {
    const four = {
      height: 9 * IN,
      rings: [
        { position: 0.4, circumference: 32 * IN },
        { position: 0.8, circumference: 22 * IN },
        { position: 6.5 / 9, circumference: 32.75 * IN },
        { position: 0.1, circumference: 20 * IN },
      ],
    };
    expect(describeSelection(four, 2, "in")).toBe("Ring at 6 ½ in, 32 ¾ in around, 2 of 4");
    expect(describeSelection(four, 3, "in")).toBe("Ring at ⅞ in, 20 in around, 4 of 4");
    expect(describeSelection(four, 0, "cm")).toBe("Ring at 9.1 cm, 81.3 cm around, 3 of 4");
    expect(describeSelection(four, "height", "in")).toBe("Height 9 in");
    expect(describeSelection(four, 7, "in")).toBe("");
  });
});

/** Rings no smooth shape passes through: a much narrower ring just above the widest. */
const noShape: PumpkinMeasurements = {
  height: 9 * IN,
  rings: [
    { position: 0.25, circumference: 25 * IN },
    { position: 0.45, circumference: 30 * IN },
    { position: 0.452, circumference: 12 * IN },
  ],
};

function bbox(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
