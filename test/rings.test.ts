import { describe, expect, it } from "vitest";
import { buildTemplate, nextRing, type PumpkinMeasurements, type SurfaceParameters } from "../src/core";

/** Millimetres per inch and per centimetre. */
const IN = 25.4;
const CM = 10;

/** Radius of the fitted profile at height `y` (0 at mid-height), interpolated between profile points. */
function radiusAt(surface: SurfaceParameters, y: number): number {
  const p = surface.profile;
  for (let i = 1; i < p.length; i++) {
    if (p[i].height <= y) {
      const t = (y - p[i - 1].height) / (p[i].height - p[i - 1].height);
      return p[i - 1].radius + t * (p[i].radius - p[i - 1].radius);
    }
  }
  return 0;
}

/** Height above mid-height of a ring at `position` (0 = table, 1 = top). */
const heightOf = (m: PumpkinMeasurements, position: number) => m.height * (position - 0.5);

const widestRing = (m: PumpkinMeasurements) => m.rings.reduce((a, b) => (b.circumference > a.circumference ? b : a));

/** The largest radius on the profile and the height where it is. */
function widestOf(surface: SurfaceParameters) {
  return surface.profile.reduce((a, b) => (b.radius > a.radius ? b : a));
}

const pumpkins: [string, PumpkinMeasurements][] = [
  [
    "a bottom-heavy pumpkin",
    {
      height: 10 * IN,
      rings: [{ position: 0.35, circumference: 32 * IN }, { position: 0.75, circumference: 24 * IN }, { position: 0.15, circumference: 26 * IN }],
    },
  ],
  ["a tall, tapered pumpkin", { height: 14 * IN, rings: [{ position: 0.3, circumference: 30 * IN }, { position: 0.8, circumference: 18 * IN }] }],
  [
    "a barrel",
    { height: 9 * IN, rings: [{ position: 0.5, circumference: 30 * IN }, { position: 0.2, circumference: 28 * IN }, { position: 0.8, circumference: 28 * IN }] },
  ],
  [
    "a squat pumpkin in cm",
    {
      height: 25 * CM,
      rings: [
        { position: 0.45, circumference: 80 * CM },
        { position: 0.2, circumference: 66 * CM },
        { position: 0.7, circumference: 70 * CM },
        { position: 0.9, circumference: 40 * CM },
      ],
    },
  ],
  [
    "a lopsided pumpkin whose rings narrow and widen again below the widest",
    { height: 10 * IN, rings: [{ position: 0.5, circumference: 30 * IN }, { position: 0.3, circumference: 26 * IN }, { position: 0.2, circumference: 27 * IN }] },
  ],
];

describe("pumpkin profile through rings at known heights", () => {
  it.each(pumpkins)("%s: the surface passes through every ring at its height", (_name, m) => {
    const { surface, warnings } = buildTemplate({ measurements: m });

    expect(warnings).toEqual([]);
    expect(surface!.kind).toBe("revolved");
    expect(surface!.semiAxes.vertical).toBeCloseTo(m.height / 2, 9);
    for (const ring of m.rings) {
      expect((2 * Math.PI * radiusAt(surface!, heightOf(m, ring.position))) / ring.circumference).toBeCloseTo(1, 3);
    }
  });

  it.each(pumpkins)("%s: the largest ring is the widest part of the pumpkin, and nothing bulges past it", (_name, m) => {
    const { surface } = buildTemplate({ measurements: m });

    const widest = widestRing(m);
    const top = widestOf(surface!);
    expect((2 * Math.PI * top.radius) / widest.circumference).toBeCloseTo(1, 4);
    expect(Math.abs(top.height - heightOf(m, widest.position))).toBeLessThan(0.02 * m.height);
    expect(surface!.semiAxes.sideToSide).toBeCloseTo(widest.circumference / (2 * Math.PI), 4);
  });

  it.each(pumpkins)("%s: the profile never folds back up", (_name, m) => {
    const { surface } = buildTemplate({ measurements: m });

    const p = surface!.profile;
    for (let i = 1; i < p.length; i++) expect(p[i].height).toBeLessThan(p[i - 1].height);
    for (let i = 1; i < p.length - 1; i++) expect(p[i].radius).toBeGreaterThan(0);
  });

  it.each(pumpkins.slice(0, 4))("%s: the radius only grows down to the widest point and only shrinks after it", (_name, m) => {
    const { surface } = buildTemplate({ measurements: m });

    const p = surface!.profile;
    const at = p.indexOf(widestOf(surface!));
    const slack = 1e-6 * widestOf(surface!).radius;
    for (let i = 1; i < p.length; i++) {
      if (i <= at) expect(p[i].radius).toBeGreaterThanOrEqual(p[i - 1].radius - slack);
      else expect(p[i].radius).toBeLessThanOrEqual(p[i - 1].radius + slack);
    }
  });

  it("a sphere measured with several rings comes out as that sphere", () => {
    const C = 40 * IN, R = C / (2 * Math.PI);
    const rings = [0.5, 0.1, 0.3, 0.8, 0.95].map((position) => ({
      position,
      circumference: 2 * Math.PI * Math.sqrt(R ** 2 - (2 * R * (position - 0.5)) ** 2),
    }));
    const { surface, warnings } = buildTemplate({ measurements: { height: 2 * R, rings } });

    expect(warnings).toEqual([]);
    for (const p of surface!.profile) expect(Math.hypot(p.radius, p.height)).toBeCloseTo(R, 5);
  });

  it("near-equal rings above and below the widest give a flatter-sided pumpkin than the ellipsoid of the same height", () => {
    const base = { height: 9 * IN };
    const { surface: ellipsoid } = buildTemplate({ measurements: { ...base, rings: [{ position: 0.5, circumference: 30 * IN }] } });
    const { surface: barrel, warnings } = buildTemplate({
      measurements: {
        ...base,
        rings: [{ position: 0.5, circumference: 30 * IN }, { position: 0.2, circumference: 29.1 * IN }, { position: 0.8, circumference: 29.1 * IN }],
      },
    });

    expect(warnings).toEqual([]);
    // Three quarters of the way from the middle to the top, as a fraction of the widest radius:
    // cos(asin 0.75) ≈ 0.66 on the ellipsoid, much more on the barrel.
    const sideAt = (s: SurfaceParameters, fraction: number) => radiusAt(s, fraction * 4.5 * IN) / widestOf(s).radius;
    expect(sideAt(ellipsoid!, 0.75)).toBeCloseTo(Math.cos(Math.asin(0.75)), 3);
    expect(sideAt(barrel!, 0.75)).toBeGreaterThan(sideAt(ellipsoid!, 0.75) + 0.1);
    expect(sideAt(barrel!, -0.75)).toBeGreaterThan(sideAt(ellipsoid!, -0.75) + 0.1);
  });

  it("symmetric rings give a pumpkin symmetric about mid-height", () => {
    const { surface } = buildTemplate({
      measurements: {
        height: 9 * IN,
        rings: [{ position: 0.5, circumference: 30 * IN }, { position: 0.2, circumference: 28 * IN }, { position: 0.8, circumference: 28 * IN }],
      },
    });

    const p = surface!.profile;
    for (let i = 0; i < p.length; i++) {
      expect(p[i].radius).toBeCloseTo(p[p.length - 1 - i].radius, 6);
      expect(p[i].height).toBeCloseTo(-p[p.length - 1 - i].height, 6);
    }
  });

  it("a design on a ringed pumpkin projects straight back onto it and flattens with little stretch", () => {
    const square = [[-2, -2], [2, -2], [2, 2], [-2, 2]].map(([x, y]) => ({ x, y }));
    const { surface, design, template, warnings } = buildTemplate({
      measurements: {
        height: 12 * IN,
        rings: [{ position: 0.45, circumference: 32 * IN }, { position: 0.75, circumference: 29 * IN }, { position: 0.2, circumference: 30 * IN }],
      },
      design: { paths: [square], bbox: { minX: -2, minY: -2, maxX: 2, maxY: 2 } },
      placement: { width: 4 * IN, verticalOffset: -0.5 * IN, rotation: 0 },
    });

    expect(warnings).toEqual([]);
    for (const p of design!.paths[0].points) {
      const [x, y, z] = p.surface!.point;
      expect(x).toBeCloseTo(p.front.x, 9);
      expect(y).toBeCloseTo(p.front.y, 9);
      // The mesh is within 0.25 mm of the smooth shape; measured across, a little more where the side leans.
      expect(Math.abs(Math.hypot(x, z) - radiusAt(surface!, y))).toBeLessThan(2 * 0.25);
    }
    expect(template!.stretch.max).toBeLessThan(0.06);
  });
});

describe("adding a ring", () => {
  it("goes in the middle of the largest gap, counting the bottom and top as edges", () => {
    let m: PumpkinMeasurements = { height: 9 * IN, rings: [{ position: 0.5, circumference: 30 * IN }] };
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ring = nextRing(m);
      positions.push(ring.position);
      m = { ...m, rings: [...m.rings, ring] };
    }

    expect(positions).toEqual([0.25, 0.75, 0.125, 0.375]);
  });

  it.each([
    ["the default ring", { height: 9 * IN, rings: [{ position: 0.5, circumference: 30 * IN }] } as PumpkinMeasurements],
    ...pumpkins,
  ])("doesn't change the shape (%s)", (_name, m) => {
    const before = buildTemplate({ measurements: m }).surface!;
    // Up to a dozen rings or more.
    let more = m;
    for (let i = 0; i < 9; i++) more = { ...more, rings: [...more.rings, nextRing(more)] };
    const after = buildTemplate({ measurements: more });

    expect(after.warnings).toEqual([]);
    expect(after.surface!.kind).toBe(before.kind);
    after.surface!.profile.forEach((p, i) => {
      expect(p.height).toBeCloseTo(before.profile[i].height, 9);
      expect(p.radius / before.semiAxes.sideToSide).toBeCloseTo(before.profile[i].radius / before.semiAxes.sideToSide, 6);
    });
  });

  it("reads its circumference off the fitted shape at its height", () => {
    const m = pumpkins[0][1];
    const ring = nextRing(m);

    const surface = buildTemplate({ measurements: m }).surface!;
    expect((2 * Math.PI * radiusAt(surface, heightOf(m, ring.position))) / ring.circumference).toBeCloseTo(1, 4);
  });

  it("blends the rings on either side of the gap when there is no fitted shape", () => {
    const ring = nextRing({ height: Number.NaN, rings: [{ position: 0.1, circumference: 20 * IN }, { position: 0.9, circumference: 10 * IN }] });

    expect(ring.position).toBeCloseTo(0.5, 12);
    expect(ring.circumference).toBeCloseTo(15 * IN, 11);
  });

  it("copies the ring next to the gap when the gap runs to the bottom or top and there is no fitted shape", () => {
    const ring = nextRing({ height: 0, rings: [{ position: 0.5, circumference: 30 * IN }] });

    expect(ring).toEqual({ position: 0.25, circumference: 30 * IN });
  });
});
