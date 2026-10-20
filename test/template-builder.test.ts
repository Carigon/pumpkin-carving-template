import { describe, expect, it } from "vitest";
import { buildTemplate, createTemplateBuilder, type BuildProgress, type TemplateInput } from "../src/core";
import { between, ring, sphere } from "./slit-cases";

/** Millimetres per inch. */
const IN = 25.4;

const pumpkin = {
  height: 10 * IN,
  rings: [{ position: 0.4, circumference: 32 * IN }, { position: 0.8, circumference: 22 * IN }],
};
const square = {
  paths: [[{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]],
  bbox: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
};
const input: TemplateInput = {
  measurements: pumpkin,
  design: square,
  placement: { width: 3 * IN, verticalOffset: 0.5 * IN, rotation: 10 },
  slits: { count: 6, depth: 0.8 * IN },
};

describe("the template builder", () => {
  it("builds the same template as buildTemplate", () => {
    expect(createTemplateBuilder().build(input)).toEqual(buildTemplate(input));
  }, 30_000);

  it("builds in steps, reporting each slit as it is placed, to the same template", () => {
    const slitted: TemplateInput = { measurements: sphere, ...ring(30, between), slits: { count: 2, depth: 2 * IN } };
    const steps = createTemplateBuilder().steps(slitted);
    const progress: BuildProgress[] = [];
    let next = steps.next();
    for (; !next.done; next = steps.next()) progress.push(next.value);

    expect(progress).toEqual([{ slits: 1 }, { slits: 2 }]);
    expect(next.value).toEqual(buildTemplate(slitted));
    expect(next.value.template!.slits).toHaveLength(2);
  }, 30_000);

  it("previews the projected design without flattening it", () => {
    const full = buildTemplate(input);
    const quick = createTemplateBuilder().preview(input);
    expect(quick.template).toBeNull();
    expect(quick.surface).toEqual(full.surface);
    expect(quick.design).toEqual(full.design);
    expect(quick.warnings).toEqual(full.warnings.filter((w) => w.kind !== "slits-dont-fit" && w.kind !== "slit-limit"));
  });

  it("shows measurement problems in the preview", () => {
    const quick = createTemplateBuilder().preview({ ...input, measurements: { ...pumpkin, height: -1 * IN } });
    expect(quick.surface).toBeNull();
    expect(quick.warnings.map((w) => w.kind)).toContain("impossible-measurement");
  });

  it("keeps the mesh across placement, design and slit edits", () => {
    const builder = createTemplateBuilder();
    const mesh = builder.preview(input).surface!.mesh;
    expect(builder.build({ ...input, placement: { width: 4 * IN, verticalOffset: -1 * IN, rotation: 0 } }).surface!.mesh).toBe(mesh);
    expect(builder.preview({ ...input, design: undefined }).surface!.mesh).toBe(mesh);
    expect(builder.build({ ...input, slits: { count: 0, depth: 0 }, margin: 1 * IN }).surface!.mesh).toBe(mesh);
    // Equal measurements given as a new object still reuse it.
    expect(builder.preview({ ...input, measurements: structuredClone(pumpkin) }).surface!.mesh).toBe(mesh);
  });

  it("rebuilds the mesh when the measurements change", () => {
    const builder = createTemplateBuilder();
    const mesh = builder.preview(input).surface!.mesh;
    const taller = builder.preview({ ...input, measurements: { ...pumpkin, height: 11 * IN } });
    expect(taller.surface!.mesh).not.toBe(mesh);
    expect(taller.surface!.semiAxes.vertical).toBeCloseTo(5.5 * IN);
  });
});
