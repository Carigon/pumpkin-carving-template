import { describe, expect, it } from "vitest";
import { fitProfile, type PumpkinMeasurements } from "../src/core";
import { placeMeasureWarnings } from "../src/measureWarnings";
import { withRingIds } from "../src/ringEdits";

/** mm per inch. */
const IN = 25.4;
/** Rings no smooth pumpkin passes through: a 12 in ring a hair above the widest, 30 in one. */
const unfit = withRingIds({
  height: 9 * IN,
  rings: [{ position: 0.25, circumference: 25 * IN }, { position: 0.45, circumference: 30 * IN }, { position: 0.452, circumference: 12 * IN }],
});
const ids = unfit.rings.map((r) => r.id);

/** The fit's warnings (none when it fits). */
const warningsOf = (m: PumpkinMeasurements) => {
  const fit = fitProfile(m);
  return fit.ok ? [] : fit.warnings;
};

describe("where the Measure form shows the measurement warnings", () => {
  it("puts a failed fit on the row of the ring edited last", () => {
    expect(fitProfile(unfit).ok).toBe(false);

    const placed = placeMeasureWarnings(warningsOf(unfit), ids, 1);

    expect(placed.rings.get(1)).toEqual([expect.stringMatching(/No smooth pumpkin shape passes through this ring/)]);
    expect(placed.rings.get(0)).toEqual([]);
    expect(placed.rings.get(2)).toEqual([]);
    expect(placed.table).toEqual([]);
  });

  it("marks no row for a failed fit when no ring has been edited (a page load)", () => {
    const placed = placeMeasureWarnings(warningsOf(unfit), ids, null);

    expect(placed.table).toEqual([expect.stringMatching(/No smooth pumpkin shape passes through these rings/)]);
    for (const id of ids) expect(placed.rings.get(id)).toEqual([]);
  });

  it("marks no row when the ring edited last isn't shown (deleted, or not the test-grid ball)", () => {
    const placed = placeMeasureWarnings(warningsOf(unfit), ids, 7);

    expect(placed.table).toHaveLength(1);
    for (const id of ids) expect(placed.rings.get(id)).toEqual([]);
  });

  it("puts a ring's own warning on its row, by its index, whoever was edited last", () => {
    const m = withRingIds({
      height: 9 * IN,
      rings: [{ position: 0.4, circumference: 30 * IN }, { position: 0.7, circumference: Number.NaN }],
    });
    const placed = placeMeasureWarnings(warningsOf(m), [5, 9], 5);

    expect(placed.rings.get(9)).toEqual(["Circumference must be a positive number."]);
    expect(placed.rings.get(5)).toEqual([]);
    expect(placed.table).toEqual([]);
  });

  it("puts a height warning under the Height", () => {
    const placed = placeMeasureWarnings(warningsOf({ height: Number.NaN, rings: [{ position: 0.5, circumference: 30 * IN }] }), [0], 0);

    expect(placed.height).toEqual(["Height must be a positive number."]);
    expect(placed.rings.get(0)).toEqual([]);
  });
});
