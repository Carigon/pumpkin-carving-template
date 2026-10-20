import { describe, expect, it } from "vitest";
import { fitProfile, ringAt } from "../src/core";
import { deleteRing, dragBall, dragHeight, dragRing, insertRing, nudgeLength, sortRings, withRingIds, type RingMeasurements } from "../src/ringEdits";

/** mm per inch. */
const IN = 25.4;
/** 9 in tall, a 32 in ring at 0.4 (id 0) and a 22 in ring at 0.8 (id 1). */
const pumpkin: RingMeasurements = withRingIds({
  height: 9 * IN,
  rings: [{ position: 0.4, circumference: 32 * IN }, { position: 0.8, circumference: 22 * IN }],
});
const free = { units: "in", snap: false } as const;

/** A ring's height above the table, in mm. */
const above = (m: RingMeasurements, id: number) => {
  const ring = m.rings.find((r) => r.id === id)!;
  return ring.position * m.height;
};
const around = (m: RingMeasurements, id: number) => m.rings.find((r) => r.id === id)!.circumference;

describe("ring edits", () => {
  it("keep a dragged ring's radius within 10 to 500 mm, and say so", () => {
    const tiny = dragRing(pumpkin, 1, { circumference: 2 * Math.PI * 4 }, free);
    expect(around(tiny.measurements, 1)).toBeCloseTo(2 * Math.PI * 10, 9);
    expect(tiny.note?.limit).toBe("ring-size");
    expect(tiny.note?.message).toMatch(/around/);

    // A tall pumpkin, so the shape ratio leaves room for the widest ring to hit the absolute limit.
    const tall = { ...pumpkin, height: 900 };
    const huge = dragRing(tall, 0, { circumference: 2 * Math.PI * 600 }, free);
    expect(around(huge.measurements, 0)).toBeCloseTo(2 * Math.PI * 500, 9);
    expect(huge.note?.limit).toBe("ring-size");

    const fine = dragRing(pumpkin, 1, { circumference: 20 * IN }, free);
    expect(around(fine.measurements, 1)).toBeCloseTo(20 * IN, 9);
    expect(fine.note).toBeNull();
  });

  it("keep a dragged height within 20 to 1000 mm, and say so", () => {
    // One ring at mid-height, sized so the shape ratio allows both limits.
    const small = withRingIds({ height: 100, rings: [{ position: 0.5, circumference: 40 * Math.PI }] });
    const low = dragHeight(small, 5, free);
    expect(low.measurements.height).toBe(20);
    expect(low.note?.limit).toBe("height");
    expect(low.note?.message).toMatch(/height/i);

    const big = withRingIds({ height: 500, rings: [{ position: 0.5, circumference: 900 * Math.PI }] });
    const high = dragHeight(big, 1200, free);
    expect(high.measurements.height).toBe(1000);
    expect(high.note?.limit).toBe("height");

    expect(dragHeight(small, 150, free)).toEqual({ measurements: { ...small, height: 150 }, note: null });
  });

  it("move a dragged ring up and down, keeping it 5 mm from its neighbours, the table and the top", () => {
    const H = pumpkin.height; // 228.6 mm; the rings sit at 91.44 and 182.88 mm
    const moved = dragRing(pumpkin, 0, { above: 120 }, free);
    expect(above(moved.measurements, 0)).toBeCloseTo(120, 9);
    expect(moved.note).toBeNull();

    const up = dragRing(pumpkin, 0, { above: 200 }, free);
    expect(above(up.measurements, 0)).toBeCloseTo(182.88 - 5, 9);
    expect(up.note?.limit).toBe("margin");
    expect(up.note?.message).toMatch(/apart/);

    expect(above(dragRing(pumpkin, 0, { above: -10 }, free).measurements, 0)).toBeCloseTo(5, 9);
    expect(above(dragRing(pumpkin, 1, { above: 90 }, free).measurements, 1)).toBeCloseTo(91.44 + 5, 9);
    expect(above(dragRing(pumpkin, 1, { above: 300 }, free).measurements, 1)).toBeCloseTo(H - 5, 9);
  });

  it("never pull a dragged ring past where it already sits when it's closer than the margin", () => {
    // Ring 1 sits 2 mm above ring 0, and ring 0 2 mm above the table.
    const close = withRingIds({
      height: 200,
      rings: [{ position: 2 / 200, circumference: 600 }, { position: 4 / 200, circumference: 500 }],
    });
    // Dragged a little further away, it goes there; dragged closer, it stays put.
    expect(above(dragRing(close, 1, { above: 5 }, free).measurements, 1)).toBeCloseTo(5, 9);
    expect(above(dragRing(close, 1, { above: 3 }, free).measurements, 1)).toBeCloseTo(4, 9);
    // Ring 0 is too close both to the table and to ring 1, so it can't move at all.
    expect(above(dragRing(close, 0, { above: 1 }, free).measurements, 0)).toBeCloseTo(2, 9);
    expect(above(dragRing(close, 0, { above: 3 }, free).measurements, 0)).toBeCloseTo(2, 9);
    // Neither neighbour jumps.
    expect(above(dragRing(close, 0, { above: 1 }, free).measurements, 1)).toBeCloseTo(4, 9);
  });

  it("change the height keeping every ring's fraction and circumference", () => {
    const { measurements, note } = dragHeight(pumpkin, 10 * IN, free);
    expect(note).toBeNull();
    expect(measurements.height).toBeCloseTo(10 * IN, 9);
    expect(measurements.rings).toEqual(pumpkin.rings);
  });

  it("stop the height where the tightest gap would come within the margin", () => {
    // Gaps of 0.1, 0.05 (the tightest) and 0.85 of the height.
    const m = withRingIds({
      height: 300,
      rings: [{ position: 0.15, circumference: 600 }, { position: 0.1, circumference: 500 }],
    });
    const { measurements, note } = dragHeight(m, 50, free);
    expect(measurements.height).toBeCloseTo(5 / 0.05, 9);
    expect(note?.limit).toBe("margin");
    expect(measurements.rings).toEqual(m.rings);

    // The gap against the top counts too.
    const nearTop = withRingIds({ height: 300, rings: [{ position: 0.96, circumference: 600 }] });
    expect(dragHeight(nearTop, 50, free).measurements.height).toBeCloseTo(5 / 0.04, 9);
  });

  it("never pull the height past where it already is when a gap is already inside the margin", () => {
    // A 3 mm gap: the height can grow, but not shrink.
    const m = withRingIds({ height: 300, rings: [{ position: 0.5, circumference: 600 }, { position: 0.51, circumference: 500 }] });
    expect(dragHeight(m, 250, free).measurements.height).toBe(300);
    expect(dragHeight(m, 400, free).measurements.height).toBe(400);
  });

  it("keep the height between 0.2 and 5 times the widest diameter", () => {
    // 100 mm across at its widest.
    const m = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 100 * Math.PI }, { position: 0.7, circumference: 60 * Math.PI }] });
    const tall = dragHeight(m, 800, free);
    expect(tall.measurements.height).toBeCloseTo(500, 9);
    expect(tall.note?.limit).toBe("shape-ratio");
    expect(tall.note?.message).toMatch(/tall/);

    // 400 mm across: no flatter than 80 mm tall.
    const wide = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 400 * Math.PI }] });
    const squat = dragHeight(wide, 50, free);
    expect(squat.measurements.height).toBeCloseTo(80, 9);
    expect(squat.note?.limit).toBe("shape-ratio");
  });

  it("keep the widest ring between 0.2 and 5 times the height across", () => {
    // 100 mm tall: no ring may grow past 500 mm across.
    const short = withRingIds({ height: 100, rings: [{ position: 0.5, circumference: 300 }, { position: 0.8, circumference: 200 }] });
    const grown = dragRing(short, 1, { circumference: 2000 }, free);
    expect(around(grown.measurements, 1)).toBeCloseTo(500 * Math.PI, 9);
    expect(grown.note?.limit).toBe("shape-ratio");

    // 600 mm tall: the widest ring may shrink below 120 mm across only while another ring is that wide.
    const tall = withRingIds({ height: 600, rings: [{ position: 0.5, circumference: 600 }, { position: 0.8, circumference: 400 }] });
    const shrunk = dragRing(tall, 0, { circumference: 300 }, free);
    expect(around(shrunk.measurements, 0)).toBeCloseTo(300, 9);
    expect(shrunk.note).toBeNull();
    const alone = withRingIds({ height: 600, rings: [{ position: 0.5, circumference: 600 }] });
    const held = dragRing(alone, 0, { circumference: 300 }, free);
    expect(around(held.measurements, 0)).toBeCloseTo(120 * Math.PI, 9);
    expect(held.note?.limit).toBe("shape-ratio");
  });

  it("leave a ball out of the shape ratio, keeping only the ring size limits", () => {
    // The height field (hidden in test-grid mode) says nothing about a ball, which is as tall as it is wide.
    const m = withRingIds({ height: 20, rings: [{ position: 0.5, circumference: 300 }] });
    const big = dragBall(m, 0, 2 * Math.PI * 400, free);
    expect(around(big.measurements, 0)).toBeCloseTo(2 * Math.PI * 400, 9);
    expect(big.note).toBeNull();
    const huge = dragBall(m, 0, 2 * Math.PI * 600, free);
    expect(around(huge.measurements, 0)).toBeCloseTo(2 * Math.PI * 500, 9);
    expect(huge.note?.limit).toBe("ring-size");
  });

  it("snap a drag to ⅛ in or 1 mm counted from 0, and leave a free drag where it is", () => {
    const inches = { units: "in", snap: true } as const;
    const ring = dragRing(pumpkin, 0, { above: 101, circumference: 800 }, inches).measurements;
    // 101 mm is 31.8 eighths, rounding to 32 (4 in); 800 mm is 251.97 eighths, rounding to 252 (31.5 in).
    expect(above(ring, 0)).toBeCloseTo(4 * IN, 9);
    expect(around(ring, 0)).toBeCloseTo(31.5 * IN, 9);
    expect(dragHeight(pumpkin, 240, inches).measurements.height).toBeCloseTo(9.5 * IN, 9);
    const ball = withRingIds({ height: 0, rings: [{ position: 0.5, circumference: 700 }] });
    expect(around(dragBall(ball, 0, 763, inches).measurements, 0)).toBeCloseTo(30 * IN, 9);

    const cm = { units: "cm", snap: true } as const;
    const metric = dragRing(pumpkin, 0, { above: 100.4, circumference: 800.6 }, cm).measurements;
    expect(above(metric, 0)).toBeCloseTo(100, 9);
    expect(around(metric, 0)).toBeCloseTo(801, 9);
    expect(dragHeight(pumpkin, 240.5001, cm).measurements.height).toBeCloseTo(241, 9);

    const loose = dragRing(pumpkin, 0, { above: 100.4, circumference: 800.6 }, free).measurements;
    expect(above(loose, 0)).toBeCloseTo(100.4, 9);
    expect(around(loose, 0)).toBeCloseTo(800.6, 9);
    expect(dragHeight(pumpkin, 240.5, free).measurements.height).toBe(240.5);
  });

  it("nudge a length to the next point on the display unit's grid, up or down", () => {
    // On the grid: one ⅛ in (or 1 mm) step.
    expect(nudgeLength(4.5 * IN, 1, "in")).toBeCloseTo(4.625 * IN, 9);
    expect(nudgeLength(4.5 * IN, -1, "in")).toBeCloseTo(4.375 * IN, 9);
    expect(nudgeLength(100, -1, "cm")).toBeCloseTo(99, 9);
    // Off the grid: to the next grid point that way, never back where it was.
    expect(nudgeLength(4.5625 * IN, -1, "in")).toBeCloseTo(4.5 * IN, 9);
    expect(nudgeLength(4.5625 * IN, 1, "in")).toBeCloseTo(4.625 * IN, 9);
    expect(nudgeLength(100.4, 1, "cm")).toBeCloseTo(101, 9);
    // Float noise on a grid point (9 in held as 228.6 mm) still moves a whole step.
    expect(nudgeLength(228.6, 1, "in")).toBeCloseTo(9.125 * IN, 9);
    expect(nudgeLength(228.6, -1, "in")).toBeCloseTo(8.875 * IN, 9);
  });

  it("sort rings top to bottom, keeping their ids, with rings not yet placed last", () => {
    const m: RingMeasurements = {
      height: 200,
      rings: [
        { id: 4, position: 0.3, circumference: 500 },
        { id: 7, position: Number.NaN, circumference: 400 },
        { id: 2, position: 0.8, circumference: 300 },
        { id: 9, position: 0.5, circumference: 600 },
      ],
    };
    const sorted = sortRings(m);
    expect(sorted.rings.map((r) => r.id)).toEqual([2, 9, 4, 7]);
    expect(sorted.rings.find((r) => r.id === 9)).toEqual({ id: 9, position: 0.5, circumference: 600 });
    expect(sorted.height).toBe(200);
  });

  it("insert a ring at the middle of the gap picked, with the circumference the shape already has there", () => {
    // Between the 22 in ring (0.8) and the 32 in ring (0.4): at 0.6 of the height.
    const between = insertRing(pumpkin, { above: 1, below: 0 });
    expect(between.note).toBeNull();
    expect(between.id).toBe(2);
    const added = between.measurements.rings.find((r) => r.id === 2)!;
    expect(added.position).toBeCloseTo(0.6, 12);
    expect(added.circumference).toBeCloseTo(ringAt(pumpkin, 0.6), 9);
    // Sorted top to bottom, the others untouched.
    expect(between.measurements.rings.map((r) => r.id)).toEqual([1, 2, 0]);
    expect(between.measurements.height).toBe(pumpkin.height);
    // Adding it leaves the shape as it was.
    const before = fitProfile(pumpkin);
    const after = fitProfile(between.measurements);
    if (!before.ok || !after.ok) throw new Error("expected a fit");
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) expect(after.radiusAt(t)).toBeCloseTo(before.radiusAt(t), 3);

    // Against the top and the table.
    const top = insertRing(pumpkin, { above: null, below: 1 });
    expect(top.measurements.rings.find((r) => r.id === top.id)!.position).toBeCloseTo(0.9, 12);
    const bottom = insertRing(pumpkin, { above: 0, below: null });
    expect(bottom.measurements.rings.find((r) => r.id === bottom.id)!.position).toBeCloseTo(0.2, 12);
  });

  it("give an inserted ring the next id after the largest", () => {
    const m: RingMeasurements = { height: 200, rings: [{ id: 7, position: 0.5, circumference: 500 }, { id: 3, position: 0.2, circumference: 400 }] };
    expect(insertRing(m, { above: null, below: 7 }).id).toBe(8);
  });

  it("refuse a ring in a gap narrower than twice the margin, and say so", () => {
    // 200 mm tall: the rings are 9 mm apart, and 10 mm would take a ring.
    const m = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 500 }, { position: 0.545, circumference: 480 }] });
    const refused = insertRing(m, { above: 1, below: 0 });
    expect(refused.id).toBeNull();
    expect(refused.measurements).toBe(m);
    expect(refused.note?.limit).toBe("gap");
    expect(refused.note?.message).toMatch(/narrow/);

    const wider = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 500 }, { position: 0.55, circumference: 480 }] });
    expect(insertRing(wider, { above: 1, below: 0 }).id).toBe(2);
  });

  it("refuse a 21st ring, and say so", () => {
    const rings = Array.from({ length: 20 }, (_, i) => ({ position: (i + 1) / 21, circumference: 500 }));
    const full = withRingIds({ height: 600, rings });
    const refused = insertRing(full, { above: null, below: 19 });
    expect(refused.id).toBeNull();
    expect(refused.measurements).toBe(full);
    expect(refused.note?.limit).toBe("ring-count");
    expect(refused.note?.message).toMatch(/20/);
    const nineteen = withRingIds({ height: 600, rings: rings.slice(0, 19) });
    expect(insertRing(nineteen, { above: null, below: 18 }).id).toBe(19);
  });

  it("delete any ring but the last", () => {
    const deleted = deleteRing(pumpkin, 1);
    expect(deleted.note).toBeNull();
    expect(deleted.measurements).toEqual({ height: pumpkin.height, rings: [pumpkin.rings[0]] });

    const last = deleteRing(deleted.measurements, 0);
    expect(last.measurements).toBe(deleted.measurements);
    expect(last.note?.limit).toBe("ring-count");
    expect(last.note?.message).toMatch(/last ring/);
  });

  it("refuse a delete that leaves the pumpkin too tall for its width, and say so", () => {
    // 500 mm tall, 120 and 90 mm across: deleting the widest leaves it 5.6 times as tall as it is wide.
    const tall = withRingIds({ height: 500, rings: [{ position: 0.5, circumference: 120 * Math.PI }, { position: 0.7, circumference: 90 * Math.PI }] });
    const refused = deleteRing(tall, 0);
    expect(refused.measurements).toBe(tall);
    expect(refused.note?.limit).toBe("shape-ratio");
    expect(refused.note?.message).toMatch(/tall/);
    // The narrower ring goes.
    expect(deleteRing(tall, 1).note).toBeNull();
    // As does the widest, while another ring is as wide.
    const twin = withRingIds({ height: 500, rings: [{ position: 0.5, circumference: 120 * Math.PI }, { position: 0.7, circumference: 120 * Math.PI }] });
    expect(deleteRing(twin, 0).measurements.rings.map((r) => r.id)).toEqual([1]);
  });
});
