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

/** An oval, 3 units wide and 2 tall: convex, so each slit runs straight in until it nears the design. */
const oval = designOf([
  Array.from({ length: 48 }, (_, k) => ({ x: 1.5 * Math.cos((2 * Math.PI * k) / 48), y: Math.sin((2 * Math.PI * k) / 48) })),
]);

const noSlits = { count: 0, depth: 1 };

/**
 * Pumpkins and placements whose templates the analytic surface produced, kept as the reference for the mesh.
 *
 * Slits change how the paper relaxes, and where a design leaves several equally deep places for one, which it takes
 * is down to the mesh. So the star and face, which leave such choices, are flattened without slits, and slits are
 * compared on the oval, where each one's place is clear.
 */
export const referenceCases: [string, TemplateInput][] = [
  [
    "a star on a sphere",
    {
      measurements: { height: 60 / Math.PI, rings: [{ position: 0.5, circumference: 60 }], units: "in" },
      design: star,
      placement: { width: 6, verticalOffset: 1, rotation: 10 },
      slits: noSlits,
    },
  ],
  [
    "a face on a squat ellipsoid",
    {
      measurements: { height: 8, rings: [{ position: 0.5, circumference: 34 }], units: "in" },
      design: face,
      placement: { width: 5.5, verticalOffset: -0.5, rotation: 0 },
      slits: noSlits,
    },
  ],
  [
    "a face on a bottom-heavy pumpkin",
    {
      measurements: {
        height: 10,
        rings: [{ position: 0.35, circumference: 32 }, { position: 0.75, circumference: 24 }, { position: 0.15, circumference: 26 }],
        units: "in",
      },
      design: face,
      placement: { width: 6, verticalOffset: 0.5, rotation: -5 },
      slits: noSlits,
    },
  ],
  [
    "a star high up on a squat pumpkin in cm",
    {
      measurements: {
        height: 25,
        rings: [{ position: 0.45, circumference: 80 }, { position: 0.2, circumference: 66 }, { position: 0.7, circumference: 70 }, { position: 0.9, circumference: 40 }],
        units: "cm",
      },
      design: star,
      placement: { width: 12, verticalOffset: 4, rotation: 0 },
      slits: noSlits,
    },
  ],
  [
    "a slit oval on a sphere",
    {
      measurements: { height: 60 / Math.PI, rings: [{ position: 0.5, circumference: 60 }], units: "in" },
      design: oval,
      placement: { width: 5, verticalOffset: -1, rotation: 20 },
    },
  ],
  [
    "a slit oval on a squat ellipsoid",
    {
      measurements: { height: 8, rings: [{ position: 0.5, circumference: 34 }], units: "in" },
      design: oval,
      placement: { width: 5, verticalOffset: 0.5, rotation: 0 },
    },
  ],
  [
    "a slit oval on a tall, tapered pumpkin in cm",
    {
      measurements: { height: 35, rings: [{ position: 0.3, circumference: 76 }, { position: 0.8, circumference: 46 }], units: "cm" },
      design: oval,
      placement: { width: 10, verticalOffset: 2, rotation: 0 },
      slits: { count: 6, depth: 2.5 },
    },
  ],
];
