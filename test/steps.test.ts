import { describe, expect, it } from "vitest";
import { stepInMode, steps } from "../src/steps";

describe("step model", () => {
  it("pumpkin mode walks through Measure, Design and Template", () => {
    const list = steps({ mode: "pumpkin", tracing: false });
    expect(list.map((s) => [s.id, s.title])).toEqual([
      ["measure", "Measure"],
      ["design", "Design"],
      ["template", "Template"],
    ]);
  });

  it("test-grid mode sets the grid where the design would go", () => {
    const list = steps({ mode: "test-grid", tracing: false });
    expect(list.map((s) => [s.id, s.title])).toEqual([
      ["measure", "Measure"],
      ["grid", "Grid"],
      ["template", "Template"],
    ]);
  });

  it.each([
    { mode: "pumpkin", tracing: false },
    { mode: "pumpkin", tracing: true },
    { mode: "test-grid", tracing: false },
  ] as const)("every step shows the 3D view, the only one so far ($mode, tracing: $tracing)", (state) => {
    for (const step of steps(state)) {
      expect(step.defaultView).toBe("3d");
      expect(step.views).toEqual(["3d"]);
    }
  });

  it("maps the Design and Grid steps onto each other across modes and keeps the others", () => {
    expect(stepInMode("design", "test-grid")).toBe("grid");
    expect(stepInMode("grid", "pumpkin")).toBe("design");
    expect(stepInMode("design", "pumpkin")).toBe("design");
    expect(stepInMode("grid", "test-grid")).toBe("grid");
    expect(stepInMode("measure", "test-grid")).toBe("measure");
    expect(stepInMode("template", "pumpkin")).toBe("template");
  });
});
