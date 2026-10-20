import type { Design, TemplateInput } from "../../src/core";

/** A closed polygon from [x, y] pairs. */
const polygon = (points: [number, number][]) => points.map(([x, y]) => ({ x, y }));

function designOf(paths: { x: number; y: number }[][]): Design {
  const all = paths.flat();
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  return { paths, bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

/** A five-pointed star, 2 units across. */
const star = designOf([
  polygon(
    Array.from({ length: 10 }, (_, k): [number, number] => {
      const a = Math.PI / 2 + (Math.PI * k) / 5;
      const r = k % 2 === 0 ? 1 : 0.45;
      return [r * Math.cos(a), r * Math.sin(a)];
    }),
  ),
]);

/** Two triangular eyes, a nose and a wide grin with a tooth: separate pieces and a concave mouth. */
const face = designOf([
  polygon([[-3, 1], [-1.2, 1], [-2.1, 2.6]]),
  polygon([[1.2, 1], [3, 1], [2.1, 2.6]]),
  polygon([[-0.4, -0.2], [0.4, -0.2], [0, 0.6]]),
  polygon([
    [-3.4, -1], [-2, -1.4], [-0.4, -1.5], [-0.4, -1.1], [0.4, -1.1], [0.4, -1.5], [2, -1.4], [3.4, -1],
    [2.6, -2.4], [0.8, -3.1], [-0.8, -3.1], [-2.6, -2.4],
  ]),
]);

/** mm per inch and per cm. */
const IN = 25.4;
const CM = 10;

const noSlits = { count: 0, depth: 1 * IN };
/** The cut-out margin the reference templates were recorded with (3/4 in), in mm. */
const RECORDED_MARGIN = 19.05;

/**
 * Pumpkins and placements whose templates the analytic surface produced, kept as the reference for the mesh.
 * Flattened without slits: where slits go depends on the stretch, which depends on the mesh.
 * Each case gives its lengths in mm, then the mm per unit of its reference template, recorded when the core worked
 * in the carver's inches or cm.
 */
export const referenceCases: [string, TemplateInput, number][] = [
  [
    "a star on a sphere",
    {
      measurements: { height: (60 * IN) / Math.PI, rings: [{ position: 0.5, circumference: 60 * IN }] },
      design: star,
      placement: { width: 6 * IN, verticalOffset: 1 * IN, rotation: 10 },
      slits: noSlits,
      margin: RECORDED_MARGIN,
    },
    IN,
  ],
  [
    "a face on a squat ellipsoid",
    {
      measurements: { height: 8 * IN, rings: [{ position: 0.5, circumference: 34 * IN }] },
      design: face,
      placement: { width: 5.5 * IN, verticalOffset: -0.5 * IN, rotation: 0 },
      slits: noSlits,
      margin: RECORDED_MARGIN,
    },
    IN,
  ],
  [
    "a face on a bottom-heavy pumpkin",
    {
      measurements: {
        height: 10 * IN,
        rings: [{ position: 0.35, circumference: 32 * IN }, { position: 0.75, circumference: 24 * IN }, { position: 0.15, circumference: 26 * IN }],
      },
      design: face,
      placement: { width: 6 * IN, verticalOffset: 0.5 * IN, rotation: -5 },
      slits: noSlits,
      margin: RECORDED_MARGIN,
    },
    IN,
  ],
  [
    "a star high up on a squat pumpkin in cm",
    {
      measurements: {
        height: 25 * CM,
        rings: [{ position: 0.45, circumference: 80 * CM }, { position: 0.2, circumference: 66 * CM }, { position: 0.7, circumference: 70 * CM }, { position: 0.9, circumference: 40 * CM }],
      },
      design: star,
      placement: { width: 12 * CM, verticalOffset: 4 * CM, rotation: 0 },
      slits: noSlits,
      margin: RECORDED_MARGIN,
    },
    CM,
  ],
];
