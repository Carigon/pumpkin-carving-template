import { describe, expect, it } from "vitest";
import { stepInMode, steps, type StepState } from "../src/steps";

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
    { mode: "test-grid", tracing: false },
  ] as const)("without an image every step shows only the 3D view ($mode)", (state) => {
    for (const step of steps(state)) {
      expect(step.defaultView).toBe("3d");
      expect(step.views).toEqual(["3d"]);
    }
  });

  const design = (state: StepState) => steps(state).find((s) => s.id === "design")!;

  it("Design opens on the Trace view while an image is being traced, and can switch back to 3D", () => {
    const step = design({ mode: "pumpkin", tracing: true });
    expect(step.defaultView).toBe("trace");
    expect(step.views).toEqual(["3d", "trace"]);
  });

  it("Design opens on 3D once the trace is accepted, with Trace still available", () => {
    const step = design({ mode: "pumpkin", tracing: false, image: true });
    expect(step.defaultView).toBe("3d");
    expect(step.views).toEqual(["3d", "trace"]);
  });

  it.each([
    { mode: "pumpkin", tracing: true },
    { mode: "pumpkin", tracing: false, image: true },
    { mode: "test-grid", tracing: true, image: true },
  ] as const)("only the Design step offers Trace ($mode, tracing: $tracing)", (state) => {
    for (const step of steps(state).filter((s) => s.id !== "design")) {
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
