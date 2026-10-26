import { describe, expect, it } from "vitest";
import { stepInMode, steps, type StepState } from "../src/steps";

describe("step model", () => {
  it("pumpkin mode walks through Measure, Design and Template", () => {
    const list = steps({ mode: "pumpkin", tracing: false, hasImage: false, hasPage: false, warnings: [] });
    expect(list.map((s) => [s.id, s.title])).toEqual([
      ["measure", "Measure"],
      ["design", "Design"],
      ["template", "Template"],
    ]);
  });

  it("test-grid mode sets the grid where the design would go", () => {
    const list = steps({ mode: "test-grid", tracing: false, hasImage: false, hasPage: false, warnings: [] });
    expect(list.map((s) => [s.id, s.title])).toEqual([
      ["measure", "Measure"],
      ["grid", "Grid"],
      ["template", "Template"],
    ]);
  });

  it.each([
    { mode: "pumpkin", tracing: false, hasImage: false, hasPage: false, warnings: [] },
    { mode: "test-grid", tracing: false, hasImage: false, hasPage: false, warnings: [] },
  ] as const)("without an image Design/Grid shows only the 3D view ($mode)", (state) => {
    const step = steps(state).find((s) => s.id === "design" || s.id === "grid")!;
    expect(step.defaultView).toBe("3d");
    expect(step.views).toEqual(["3d"]);
  });

  it.each([
    { mode: "pumpkin", tracing: false, hasImage: false, hasPage: false, warnings: [] },
    { mode: "pumpkin", tracing: true, hasImage: true, hasPage: false, warnings: [] },
    { mode: "test-grid", tracing: false, hasImage: false, hasPage: false, warnings: [] },
  ] as const)("Measure opens on the Blueprint view and can switch to 3D ($mode)", (state) => {
    const measure = steps(state).find((s) => s.id === "measure")!;
    expect(measure.defaultView).toBe("blueprint");
    expect(measure.views).toEqual(["3d", "blueprint"]);
  });

  it.each([
    { mode: "pumpkin", tracing: true, hasImage: true, hasPage: false, warnings: [] },
    { mode: "test-grid", tracing: false, hasImage: false, hasPage: false, warnings: [] },
  ] as const)("only the Measure step offers Blueprint ($mode)", (state) => {
    for (const step of steps(state).filter((s) => s.id !== "measure")) {
      expect(step.views).not.toContain("blueprint");
    }
  });

  const design = (state: StepState) => steps(state).find((s) => s.id === "design")!;

  it("Design opens on the Photo view while an image is being traced, and can switch back to 3D", () => {
    const step = design({ mode: "pumpkin", tracing: true, hasImage: true, hasPage: false, warnings: [] });
    expect(step.defaultView).toBe("photo");
    expect(step.views).toEqual(["3d", "photo"]);
  });

  it("Design opens on 3D once the trace is accepted, with the Photo view still available", () => {
    const step = design({ mode: "pumpkin", tracing: false, hasImage: true, hasPage: false, warnings: [] });
    expect(step.defaultView).toBe("3d");
    expect(step.views).toEqual(["3d", "photo"]);
  });

  it.each([
    { mode: "pumpkin", tracing: true, hasImage: true, hasPage: false, warnings: [] },
    { mode: "pumpkin", tracing: false, hasImage: true, hasPage: false, warnings: [] },
    { mode: "test-grid", tracing: true, hasImage: true, hasPage: false, warnings: [] },
  ] as const)("only the Design step offers the Photo view ($mode, tracing: $tracing)", (state) => {
    for (const step of steps(state).filter((s) => s.id !== "design")) {
      expect(step.views).not.toContain("photo");
    }
  });

  it.each([
    { mode: "pumpkin", tracing: false, hasImage: false, hasPage: false, warnings: [] },
    { mode: "pumpkin", tracing: true, hasImage: true, hasPage: false, warnings: [] },
    { mode: "test-grid", tracing: false, hasImage: false, hasPage: false, warnings: [] },
  ] as const)("Template opens on the Paper view and can switch to 3D ($mode)", (state) => {
    const template = steps(state).find((s) => s.id === "template")!;
    expect(template.defaultView).toBe("paper");
    expect(template.views).toEqual(["3d", "paper"]);
  });

  it("only the Template step offers Paper", () => {
    for (const step of steps({ mode: "pumpkin", tracing: true, hasImage: true, hasPage: false, warnings: [] }).filter((s) => s.id !== "template")) {
      expect(step.views).not.toContain("paper");
    }
  });

  it("Design opens on the Page view while a blank page is hand-traced, in the Photo view's place", () => {
    const step = design({ mode: "pumpkin", tracing: true, hasImage: false, hasPage: true, warnings: [] });
    expect(step.defaultView).toBe("page");
    expect(step.views).toEqual(["3d", "page"]);
  });

  it("Design opens on 3D once the blank page's hand-trace is done, with the Page view still available", () => {
    const step = design({ mode: "pumpkin", tracing: false, hasImage: false, hasPage: true, warnings: [] });
    expect(step.defaultView).toBe("3d");
    expect(step.views).toEqual(["3d", "page"]);
  });

  it("only the Design step offers the Page view", () => {
    const state = { mode: "pumpkin", tracing: true, hasImage: false, hasPage: true, warnings: [] } as const;
    for (const step of steps(state).filter((s) => s.id !== "design")) expect(step.views).not.toContain("page");
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
