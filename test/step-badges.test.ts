import { describe, expect, it } from "vitest";
import { warnedSteps } from "../src/steps";

describe("step warning badges", () => {
  it.each([
    { kind: "impossible-measurement", pumpkin: "measure", grid: "measure" },
    { kind: "past-front-limit", pumpkin: "design", grid: "grid" },
    { kind: "outside-silhouette", pumpkin: "design", grid: "grid" },
    { kind: "slit-shortened", pumpkin: "template", grid: "template" },
  ] as const)("$kind badges $pumpkin in pumpkin mode and $grid in test-grid mode", ({ kind, pumpkin, grid }) => {
    expect([...warnedSteps("pumpkin", [{ kind }])]).toEqual([pumpkin]);
    expect([...warnedSteps("test-grid", [{ kind }])]).toEqual([grid]);
  });

  it("no warnings, no badges", () => {
    expect(warnedSteps("pumpkin", []).size).toBe(0);
  });

  it("badges each step with a warning once, however many warnings it has", () => {
    const badged = warnedSteps("pumpkin", [
      { kind: "past-front-limit" },
      { kind: "outside-silhouette" },
      { kind: "slit-shortened" },
    ]);
    expect([...badged].sort()).toEqual(["design", "template"]);
  });
});
