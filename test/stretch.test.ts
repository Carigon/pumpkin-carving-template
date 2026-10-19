import { describe, expect, it } from "vitest";
import { buildTemplate, type Design } from "../src/core";

/** A round design (a 32-gon), 1 unit across, centered on the origin. */
function disc(): Design {
  const path = Array.from({ length: 32 }, (_, k) => {
    const a = (2 * Math.PI * k) / 32;
    return { x: Math.cos(a) / 2, y: Math.sin(a) / 2 };
  });
  return { paths: [path], bbox: { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 } };
}

function sphere(circumference: number) {
  return { height: circumference / Math.PI, rings: [{ circumference, position: 0.5 }], units: "in" as const };
}

describe("stretch", () => {
  it("is near zero for a small design on a large, nearly flat pumpkin", () => {
    const { template } = buildTemplate({
      measurements: sphere(300),
      design: disc(),
      placement: { width: 3, verticalOffset: 0, rotation: 0 },
    });

    expect(template!.stretch.max).toBeLessThan(0.005);
  });

  it("grows for a wide design on a small sphere", () => {
    const R = 30 / (2 * Math.PI);
    const narrow = buildTemplate({
      measurements: sphere(30),
      design: disc(),
      placement: { width: 0.3 * R, verticalOffset: 0, rotation: 0 },
    }).template!.stretch;
    const wide = buildTemplate({
      measurements: sphere(30),
      design: disc(),
      // Reaches about 60° out from the front in every direction.
      placement: { width: 2 * R * Math.sin(Math.PI / 3), verticalOffset: 0, rotation: 0 },
    }).template!.stretch;

    expect(wide.max).toBeGreaterThan(0.02);
    expect(wide.max).toBeGreaterThan(3 * narrow.max);
    expect(wide.rms).toBeGreaterThan(3 * narrow.rms);
  });

  it("gives one value per triangle, shared by the 3D surface and the flat template", () => {
    const { template } = buildTemplate({
      measurements: sphere(30),
      design: disc(),
      placement: { width: 6, verticalOffset: 1, rotation: 0 },
    });
    const stretch = template!.stretch;

    expect(stretch.triangles.length).toBeGreaterThan(100);
    expect(stretch.values).toHaveLength(stretch.triangles.length);
    expect(stretch.surface).toHaveLength(stretch.flat.length);
    for (const value of stretch.values) expect(value).toBeGreaterThanOrEqual(0);
    expect(Math.max(...stretch.values)).toBeCloseTo(stretch.max, 10);

    // The 3D triangles lie on the sphere; the flat ones match the template (design center at the origin).
    const R = 30 / (2 * Math.PI);
    for (const [x, y, z] of stretch.surface) expect(Math.hypot(x, y, z)).toBeCloseTo(R, 3);
    const nearest = Math.min(...stretch.flat.map((p) => Math.hypot(p.x, p.y)));
    expect(nearest).toBeLessThan(0.5);
  });

  it("gives the outward surface normal at each 3D vertex, so the preview can draw the tint just above the skin", () => {
    const stretch = buildTemplate({
      measurements: sphere(30),
      design: disc(),
      placement: { width: 6, verticalOffset: 1, rotation: 0 },
    }).template!.stretch;

    const R = 30 / (2 * Math.PI);
    expect(stretch.normals).toHaveLength(stretch.surface.length);
    stretch.normals.forEach((n, i) => {
      // On a sphere the outward normal is the point's direction from the center.
      const p = stretch.surface[i];
      expect(n[0]).toBeCloseTo(p[0] / R, 3);
      expect(n[1]).toBeCloseTo(p[1] / R, 3);
      expect(n[2]).toBeCloseTo(p[2] / R, 3);
    });
  });
});
