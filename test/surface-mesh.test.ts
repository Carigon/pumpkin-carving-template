import { describe, expect, it } from "vitest";
import { buildTemplate, convertLength, type Design, type PumpkinMeasurements, type SurfaceParameters, type Vec3 } from "../src/core";

/** No facet may be further than this from the smooth shape it comes from: 0.25 mm. */
const meshTolerance = (units: PumpkinMeasurements["units"]) => convertLength(0.025, "cm", units);
/** The reported profile is itself a fine polyline through the smooth shape; this covers how far it cuts inside it. */
const PROFILE_SLACK_CM = 0.002;

const pumpkins: [string, PumpkinMeasurements][] = [
  [
    "a bottom-heavy pumpkin",
    { height: 10, rings: [{ position: 0.35, circumference: 32 }, { position: 0.75, circumference: 24 }, { position: 0.15, circumference: 26 }], units: "in" },
  ],
  ["a tall, tapered pumpkin", { height: 14, rings: [{ position: 0.3, circumference: 30 }, { position: 0.8, circumference: 18 }], units: "in" }],
  [
    "a squat pumpkin in cm",
    {
      height: 25,
      rings: [{ position: 0.45, circumference: 80 }, { position: 0.2, circumference: 66 }, { position: 0.7, circumference: 70 }, { position: 0.9, circumference: 40 }],
      units: "cm",
    },
  ],
  ["a sphere", { height: 60 / Math.PI, rings: [{ position: 0.5, circumference: 60 }], units: "in" }],
];

/**
 * The smooth shape seen in its side profile (radius r, height y), read off the builder's reported profile:
 * distance from a point to it, and the profile's outward normal (interpolated along it) at the nearest place.
 */
function profileShape(surface: SurfaceParameters) {
  const p = surface.profile;
  // Outward normals at the profile points: the segment directions turned outward, averaged at each point.
  const segmentNormals = p.slice(1).map((b, i) => {
    const dr = b.radius - p[i].radius, dy = b.height - p[i].height;
    const len = Math.hypot(dr, dy);
    return [-dy / len, dr / len] as const;
  });
  const pointNormals = p.map((_, i) => {
    const a = segmentNormals[Math.max(0, i - 1)], b = segmentNormals[Math.min(segmentNormals.length - 1, i)];
    const len = Math.hypot(a[0] + b[0], a[1] + b[1]);
    return [(a[0] + b[0]) / len, (a[1] + b[1]) / len] as const;
  });

  const nearest = (r: number, y: number) => {
    let best = { distance: Infinity, i: 0, t: 0 };
    for (let i = 0; i + 1 < p.length; i++) {
      const dr = p[i + 1].radius - p[i].radius, dy = p[i + 1].height - p[i].height;
      const len2 = dr * dr + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((r - p[i].radius) * dr + (y - p[i].height) * dy) / len2)) : 0;
      const distance = Math.hypot(r - p[i].radius - t * dr, y - p[i].height - t * dy);
      if (distance < best.distance) best = { distance, i, t };
    }
    return best;
  };

  return {
    distance(point: Vec3): number {
      return nearest(Math.hypot(point[0], point[2]), point[1]).distance;
    },
    normal(point: Vec3): Vec3 {
      const { i, t } = nearest(Math.hypot(point[0], point[2]), point[1]);
      const a = pointNormals[i], b = pointNormals[i + 1];
      const nr = a[0] + t * (b[0] - a[0]), ny = a[1] + t * (b[1] - a[1]);
      const u = Math.atan2(point[0], point[2]);
      const n: Vec3 = [nr * Math.sin(u), ny, nr * Math.cos(u)];
      const len = Math.hypot(...n);
      return [n[0] / len, n[1] / len, n[2] / len];
    },
    /** Radius of the silhouette at height y. */
    radiusAt(y: number): number {
      for (let i = 1; i < p.length; i++) {
        if (p[i].height <= y) {
          const t = (y - p[i - 1].height) / (p[i].height - p[i - 1].height);
          return p[i - 1].radius + t * (p[i].radius - p[i - 1].radius);
        }
      }
      return 0;
    },
  };
}

const degreesBetween = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/** Single-point "paths" at the given front-view positions; placed at width 2, design units are measurement units. */
function pointsDesign(points: [number, number][]): Design {
  return { paths: points.map(([x, y]) => [{ x, y }]), bbox: { minX: -1, minY: -1, maxX: 1, maxY: 1 } };
}

describe.each(pumpkins)("%s as a triangle mesh", (_name, m) => {
  const tolerance = meshTolerance(m.units);
  const slack = convertLength(PROFILE_SLACK_CM, "cm", m.units);
  const { surface } = buildTemplate({ measurements: m });
  const shape = profileShape(surface!);
  const half = m.height / 2;

  it("has no facet further than 0.25 mm from the smooth shape", () => {
    const { positions, triangles } = surface!.mesh;
    const vertex = (i: number): Vec3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    const mix = (ps: Vec3[], ws: number[]): Vec3 =>
      [0, 1, 2].map((k) => ps.reduce((sum, p, j) => sum + ws[j] * p[k], 0)) as unknown as Vec3;

    expect(triangles.length % 3).toBe(0);
    expect(triangles.length).toBeGreaterThan(0);
    let worst = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const corners = [vertex(triangles[t]), vertex(triangles[t + 1]), vertex(triangles[t + 2])];
      for (const ws of [[1, 0, 0], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
        worst = Math.max(worst, shape.distance(mix(corners, ws)));
      }
    }
    expect(worst).toBeLessThan(tolerance + slack);
  });

  it("carries a unit normal at every vertex", () => {
    const { positions, normals } = surface!.mesh;
    expect(normals.length).toBe(positions.length);
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 9);
    }
  });

  it("projects front-view points onto the smooth shape, with its normal, within the mesh tolerance", () => {
    const front: [number, number][] = [];
    for (let i = -9; i <= 9; i++) {
      const y = (0.9 * half * i) / 9;
      const r = shape.radiusAt(y);
      for (let j = -9; j <= 9; j++) front.push([(0.95 * r * j) / 9, y]);
    }

    const { design, warnings } = buildTemplate({ measurements: m, design: pointsDesign(front), placement: { width: 2, verticalOffset: 0, rotation: 0 } });

    expect(warnings.filter((w) => w.kind === "outside-silhouette")).toEqual([]);
    design!.paths.forEach(({ points: [p] }, k) => {
      const { point, normal } = p.surface!;
      expect(point[0]).toBeCloseTo(front[k][0], 9);
      expect(point[1]).toBeCloseTo(front[k][1], 9);
      expect(point[2]).toBeGreaterThan(0);
      expect(shape.distance(point)).toBeLessThan(tolerance + slack);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 9);
      expect(degreesBetween(normal, shape.normal(point))).toBeLessThan(0.5);
    });
  });

  it("misses just outside the silhouette and hits just inside it", () => {
    const margin = 2 * tolerance;
    const heights = Array.from({ length: 15 }, (_, i) => (0.8 * half * (i - 7)) / 7);
    const outside: [number, number][] = heights.flatMap((y) => [[shape.radiusAt(y) + margin, y], [-shape.radiusAt(y) - margin, y]]);
    outside.push([0, half + margin], [0, -half - margin]);
    const inside: [number, number][] = heights.flatMap((y) => [[shape.radiusAt(y) - margin, y], [-shape.radiusAt(y) + margin, y]]);

    const { design, warnings } = buildTemplate({
      measurements: m,
      design: pointsDesign([...outside, ...inside]),
      placement: { width: 2, verticalOffset: 0, rotation: 0 },
    });

    const hits = design!.paths.map(({ points: [p] }) => p.surface !== null);
    expect(hits).toEqual([...outside.map(() => false), ...inside.map(() => true)]);
    expect(warnings.find((w) => w.kind === "outside-silhouette")).toMatchObject({ count: outside.length });
  });
});
