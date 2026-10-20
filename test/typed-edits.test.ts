import { describe, expect, it } from "vitest";
import { fitProfile } from "../src/core";
import { typeCircumference, typeHeight, typeRingHeight, withRingIds, type RingMeasurements } from "../src/ringEdits";

/** mm per inch. */
const IN = 25.4;
/** 9 in tall, a 32 in ring at 0.4 (id 0) and a 22 in ring at 0.8 (id 1). */
const pumpkin: RingMeasurements = withRingIds({
  height: 9 * IN,
  rings: [{ position: 0.4, circumference: 32 * IN }, { position: 0.8, circumference: 22 * IN }],
});

/** A ring's height above the table, in mm. */
const above = (m: RingMeasurements, id: number) => {
  const ring = m.rings.find((r) => r.id === id)!;
  return ring.position * m.height;
};
const around = (m: RingMeasurements, id: number) => m.rings.find((r) => r.id === id)!.circumference;

describe("typed ring edits", () => {
  it("keep a typed ring height 5 mm above the table and below the top, and say so", () => {
    const low = typeRingHeight(pumpkin, 0, 2, "in");
    expect(above(low.measurements, 0)).toBeCloseTo(5, 9);
    expect(low.note?.limit).toBe("margin");
    expect(low.note?.message).toMatch(/table/);

    const high = typeRingHeight(pumpkin, 1, 300, "in");
    expect(above(high.measurements, 1)).toBeCloseTo(9 * IN - 5, 9);
    expect(high.note?.limit).toBe("margin");

    // Typed values never snap: 100.37 mm is no eighth of an inch.
    const fine = typeRingHeight(pumpkin, 0, 100.37, "in");
    expect(above(fine.measurements, 0)).toBeCloseTo(100.37, 9);
    expect(fine.note).toBeNull();
    expect(fine.warning).toBeNull();
  });

  it("let a typed ring pass its neighbours, and accept one within 5 mm of another with a soft warning", () => {
    // Ring 0 (at 91.44 mm) typed past ring 1 (at 182.88 mm).
    const passed = typeRingHeight(pumpkin, 0, 200, "in");
    expect(above(passed.measurements, 0)).toBeCloseTo(200, 9);
    expect(passed.note).toBeNull();
    expect(passed.warning).toBeNull();

    const close = typeRingHeight(pumpkin, 0, 180, "in");
    expect(above(close.measurements, 0)).toBeCloseTo(180, 9);
    expect(close.note).toBeNull();
    expect(close.warning).toMatch(/0\.2 in/);
  });

  it("leave a typed height on another ring's for the core's error", () => {
    // 7.2 in is exactly ring 1's height.
    const same = typeRingHeight(pumpkin, 0, 7.2 * IN, "in");
    expect(same.note).toBeNull();
    expect(same.warning).toBeNull();
    const fit = fitProfile(same.measurements);
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.warnings.map((w) => w.message)).toContain("Another ring is already at this height.");
  });

  it("keep a typed circumference within the ring size limits and the shape ratio, without snapping", () => {
    const tiny = typeCircumference(pumpkin, 1, 2 * Math.PI * 4, { units: "in", ball: false });
    expect(around(tiny.measurements, 1)).toBeCloseTo(2 * Math.PI * 10, 9);
    expect(tiny.note?.limit).toBe("ring-size");

    // 4 in tall: no ring may grow past 20 in across.
    const short = { ...pumpkin, height: 4 * IN };
    const grown = typeCircumference(short, 1, 100 * IN, { units: "in", ball: false });
    expect(around(grown.measurements, 1)).toBeCloseTo(20 * IN * Math.PI, 9);
    expect(grown.note?.limit).toBe("shape-ratio");

    // The only ring that wide can't shrink below 9 / 5 in across.
    const alone = withRingIds({ height: 9 * IN, rings: [{ position: 0.5, circumference: 30 * IN }] });
    const shrunk = typeCircumference(alone, 0, 4 * IN, { units: "cm", ball: false });
    expect(around(shrunk.measurements, 0)).toBeCloseTo((9 / 5) * IN * Math.PI, 9);
    expect(shrunk.note?.limit).toBe("shape-ratio");
    expect(shrunk.note?.message).toMatch(/wide/);

    const fine = typeCircumference(pumpkin, 0, 800.37, { units: "in", ball: false });
    expect(around(fine.measurements, 0)).toBe(800.37);
    expect(fine.note).toBeNull();
  });

  it("keep a typed height within 20 to 1000 mm, the shape ratio and the tightest gap, without snapping", () => {
    const small = withRingIds({ height: 100, rings: [{ position: 0.5, circumference: 40 * Math.PI }] });
    const low = typeHeight(small, 5, "in");
    expect(low.measurements.height).toBe(20);
    expect(low.note?.limit).toBe("height");

    // 100 mm across: no taller than 500 mm.
    const narrow = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 100 * Math.PI }] });
    const tall = typeHeight(narrow, 800, "in");
    expect(tall.measurements.height).toBeCloseTo(500, 9);
    expect(tall.note?.limit).toBe("shape-ratio");

    // Gaps of 0.1, 0.05 (the tightest) and 0.85 of the height.
    const gapped = withRingIds({ height: 300, rings: [{ position: 0.15, circumference: 300 }, { position: 0.1, circumference: 250 }] });
    const tight = typeHeight(gapped, 80, "cm");
    expect(tight.measurements.height).toBeCloseTo(100, 9);
    expect(tight.note?.limit).toBe("margin");

    // Rings keep their fractions and circumferences, and the value isn't snapped.
    const fine = typeHeight(pumpkin, 240.37, "in");
    expect(fine.measurements).toEqual({ height: 240.37, rings: pumpkin.rings });
    expect(fine.note).toBeNull();
  });

  it("leave a typed ball out of the shape ratio", () => {
    const ball = withRingIds({ height: 20, rings: [{ position: 0.5, circumference: 300 }] });
    const big = typeCircumference(ball, 0, 2 * Math.PI * 400.3, { units: "in", ball: true });
    expect(around(big.measurements, 0)).toBeCloseTo(2 * Math.PI * 400.3, 9);
    expect(big.note).toBeNull();
    const huge = typeCircumference(ball, 0, 2 * Math.PI * 600, { units: "in", ball: true });
    expect(around(huge.measurements, 0)).toBeCloseTo(2 * Math.PI * 500, 9);
    expect(huge.note?.limit).toBe("ring-size");
  });
});
