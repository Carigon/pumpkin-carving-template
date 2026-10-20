import { describe, expect, it } from "vitest";
import { ringAt } from "../src/core";
import { deleteRing, insertRing, withRingIds } from "../src/ringEdits";

/** 228.6 mm tall, a 32 in ring at 0.4 (id 0) and a 22 in ring at 0.8 (id 1). */
const pumpkin = withRingIds({ height: 228.6, rings: [{ position: 0.4, circumference: 812.8 }, { position: 0.8, circumference: 558.8 }] });

describe("inserting and deleting rings (the #54 contract the form relies on)", () => {
  it("insert at a gap's midpoint with the circumference the shape has there, under the next id, sorted", () => {
    const { measurements, id, note } = insertRing(pumpkin, { above: 1, below: 0 });
    expect(note).toBeNull();
    expect(id).toBe(2);
    expect(measurements.rings.map((r) => r.id)).toEqual([1, 2, 0]);
    const added = measurements.rings.find((r) => r.id === 2)!;
    expect(added.position).toBeCloseTo(0.6, 12);
    expect(added.circumference).toBeCloseTo(ringAt(pumpkin, 0.6), 9);

    // Above the top ring, and below the bottom one.
    expect(insertRing(pumpkin, { above: null, below: 1 }).measurements.rings[0].position).toBeCloseTo(0.9, 12);
    expect(insertRing(pumpkin, { above: 0, below: null }).measurements.rings.at(-1)!.position).toBeCloseTo(0.2, 12);
  });

  it("refuse a gap under 10 mm and a 21st ring", () => {
    const close = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 500 }, { position: 0.54, circumference: 500 }] });
    const narrow = insertRing(close, { above: 1, below: 0 });
    expect(narrow.id).toBeNull();
    expect(narrow.measurements).toBe(close);
    expect(narrow.note).not.toBeNull();

    const full = withRingIds({ height: 900, rings: Array.from({ length: 20 }, (_, i) => ({ position: (i + 1) / 21, circumference: 500 })) });
    expect(insertRing(full, { above: 0, below: null }).id).toBeNull();
  });

  it("delete any ring but the last", () => {
    expect(deleteRing(pumpkin, 0).measurements.rings.map((r) => r.id)).toEqual([1]);
    const one = withRingIds({ height: 200, rings: [{ position: 0.5, circumference: 500 }] });
    const refused = deleteRing(one, 0);
    expect(refused.measurements).toBe(one);
    expect(refused.note).not.toBeNull();
  });
});
