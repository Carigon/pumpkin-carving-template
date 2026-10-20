import type { Design, FlatTemplate, Point2, PumpkinMeasurements, TemplateInput } from "../src/core";

export function designOf(...paths: [number, number][][]): Design {
  const all = paths.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  return {
    paths: paths.map((path) => path.map(([x, y]) => ({ x, y }))),
    bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

/** A closed circle of 24 points. */
export const circle = (cx: number, cy: number, r: number): [number, number][] =>
  Array.from({ length: 24 }, (_, k) => [cx + r * Math.cos((k * Math.PI) / 12), cy + r * Math.sin((k * Math.PI) / 12)]);

/** Even-odd point-in-polygon test. */
export function insidePolygon(p: Point2, polygon: Point2[]): boolean {
  let inside = false;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  });
  return inside;
}

/**
 * Stretch on the paper (triangles whose middle is inside the cut-out edge), weighted by surface area: the root mean
 * square and the 95th percentile. The worst single triangles sit at slit tips and depend on the mesh, so the
 * maximum is left out.
 */
export function paperStrain({ stretch, cutOutline }: FlatTemplate): { rms: number; p95: number } {
  const items: { value: number; area: number }[] = [];
  stretch.triangles.forEach((tri, t) => {
    const [a, b, c] = tri.map((v) => stretch.flat[v]);
    if (!insidePolygon({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, cutOutline)) return;
    const [p, q, r] = tri.map((v) => stretch.surface[v]);
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    items.push({ value: stretch.values[t], area });
  });
  const total = items.reduce((s, i) => s + i.area, 0);
  const rms = Math.sqrt(items.reduce((s, i) => s + i.area * i.value ** 2, 0) / total);
  items.sort((a, b) => a.value - b.value);
  let sum = 0;
  const p95 = items.find((i) => (sum += i.area) >= 0.95 * total)?.value ?? 0;
  return { rms, p95 };
}

/** mm per inch. */
export const IN = 25.4;

const deg = Math.PI / 180;
const CIRCUMFERENCE = 60 * IN;
const R = CIRCUMFERENCE / (2 * Math.PI);
/** A sphere 60 in around. */
export const sphere: PumpkinMeasurements = { height: 2 * R, rings: [{ circumference: CIRCUMFERENCE, position: 0.5 }] };
/** Front-view point (in mm) whose surface point is `angle` (radians) from the front of `sphere`, along `heading`. */
export const onSphere = (angle: number, heading: number): [number, number] => [
  R * Math.sin(angle) * Math.cos(heading),
  R * Math.sin(angle) * Math.sin(heading),
];
/** A small round carve area about 0.6 in across, `angle` from the front of `sphere` along `heading`. */
export const dot = (angle: number, heading: number): [number, number][] => {
  const [cx, cy] = onSphere(angle, heading);
  return circle(cx, cy, 0.3 * IN);
};
/** Dots `angle`° from the front of `sphere` at `headings`°, plus one in the middle: blank paper between them. */
export function ring(angle: number, headings: number[]): Pick<TemplateInput, "design" | "placement"> {
  const design = designOf(dot(0, 0), ...headings.map((h) => dot(angle * deg, h * deg)));
  return { design, placement: { width: design.bbox.maxX - design.bbox.minX, verticalOffset: 0, rotation: 0 } };
}
/** Eight headings, 45° apart. */
export const between = [0, 45, 90, 135, 180, 225, 270, 315].map((h) => h + 22.5);

/** A design `width` mm wide seen from the front, `verticalOffset` mm above the pumpkin's middle. */
export const placed = (design: Design, width: number, verticalOffset = 0): Pick<TemplateInput, "design" | "placement"> => ({
  design,
  placement: { width, verticalOffset, rotation: 0 },
});
/** A ring of 8 dots plus one in the middle, at `start`° and every 45° from there. */
export const dots = (start: number) =>
  designOf(circle(0, 0, 0.5), ...Array.from({ length: 8 }, (_, k) => circle(2.4 * Math.cos((start + 45 * k) * deg), 2.4 * Math.sin((start + 45 * k) * deg), 0.45)));

/** A pumpkin wider than tall, widest a little below the middle. */
export const squat: PumpkinMeasurements = { height: 6.5 * IN, rings: [{ position: 0.45, circumference: 36 * IN }] };
/** A pumpkin that tapers toward the stem. */
export const tapering: PumpkinMeasurements = {
  height: 10 * IN,
  rings: [{ position: 0.35, circumference: 31 * IN }, { position: 0.65, circumference: 26 * IN }, { position: 0.85, circumference: 18 * IN }],
};

/**
 * Designs whose paper stretch with evenly spaced slits (the old placement: slit k at 90° + k·360°/count around the
 * design center, up to 2 in deep, with a 3/4 in margin) is recorded in `even-spacing.json`, by slit count.
 */
export const evenSpacingCases: [string, TemplateInput][] = [
  // Dots where the evenly spaced slits start, so those have to steer around them.
  ["dots at 90°, 135°, ... on a squat pumpkin", { measurements: squat, ...placed(dots(90), 5.8 * IN), margin: 0.75 * IN }],
];
