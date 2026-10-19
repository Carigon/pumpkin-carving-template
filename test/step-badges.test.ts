import { describe, expect, it } from "vitest";
import { steps, type Mode, type StepState } from "../src/steps";

/** The steps whose tab carries a warning badge. */
function badged(mode: Mode, warnings: StepState["warnings"]) {
  return steps({ mode, tracing: false, hasImage: false, warnings })
    .filter((s) => s.warned)
    .map((s) => s.id);
}

describe("step warning badges", () => {
  it.each([
    { kind: "impossible-measurement", pumpkin: "measure", grid: "measure" },
    { kind: "past-front-limit", pumpkin: "design", grid: "grid" },
    { kind: "outside-silhouette", pumpkin: "design", grid: "grid" },
    { kind: "slit-shortened", pumpkin: "template", grid: "template" },
  ] as const)("$kind badges $pumpkin in pumpkin mode and $grid in test-grid mode", ({ kind, pumpkin, grid }) => {
    expect(badged("pumpkin", [{ kind }])).toEqual([pumpkin]);
    expect(badged("test-grid", [{ kind }])).toEqual([grid]);
  });

  it("no warnings, no badges", () => {
    expect(badged("pumpkin", [])).toEqual([]);
  });

  it("badges each step with a warning once, however many warnings it has", () => {
    const list = badged("pumpkin", [{ kind: "past-front-limit" }, { kind: "outside-silhouette" }, { kind: "slit-shortened" }]);
    expect(list).toEqual(["design", "template"]);
  });
});
