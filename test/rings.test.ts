import { describe, expect, it } from "vitest";
import { buildTemplate, fitProfile, ringAt, type PumpkinMeasurements, type SurfaceParameters } from "../src/core";

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

describe("fitting the profile alone", () => {
  it.each(pumpkins)("%s: gives the same profile as the template builder", (_name, m) => {
    const fit = fitProfile(m);

    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.profile).toEqual(buildTemplate({ measurements: m }).surface!.profile);
  });

  it.each(pumpkins)("%s: gives each ring's circumference at its height", (_name, m) => {
    const fit = fitProfile(m);

    if (!fit.ok) throw new Error("no fit");
    for (const ring of m.rings) expect((2 * Math.PI * fit.radiusAt(ring.position)) / ring.circumference).toBeCloseTo(1, 6);
  });
});

describe("the ring at a height", () => {
  /** Where the form puts a new ring: the middle of the largest gap, the bottom and top counting as edges. */
  function largestGapMiddle(m: PumpkinMeasurements): number {
    const stops = [0, ...m.rings.map((r) => r.position).sort((a, b) => a - b), 1];
    let gap = 0;
    for (let i = 1; i + 1 < stops.length; i++) if (stops[i + 1] - stops[i] > stops[gap + 1] - stops[gap] + 1e-12) gap = i;
    return (stops[gap] + stops[gap + 1]) / 2;
  }
  const withRingAt = (m: PumpkinMeasurements, position: number): PumpkinMeasurements => ({
    ...m,
    rings: [...m.rings, { position, circumference: ringAt(m, position) }],
  });

  it("reads its circumference off the fitted profile at that height", () => {
    const m = pumpkins[0][1];

    const surface = buildTemplate({ measurements: m }).surface!;
    // Within the error of interpolating between the reported profile's points.
    for (const position of [0.05, 0.25, 0.6, 0.97]) {
      expect((2 * Math.PI * radiusAt(surface, heightOf(m, position))) / ringAt(m, position)).toBeCloseTo(1, 3);
    }
  });

  it.each([
    ["the default ring", { height: 9 * IN, rings: [{ position: 0.5, circumference: 30 * IN }] } as PumpkinMeasurements],
    ...pumpkins,
  ])("added to the rings, doesn't change the shape (%s)", (_name, m) => {
    const before = buildTemplate({ measurements: m }).surface!;
    // Up to a dozen rings or more.
    let more = m;
    for (let i = 0; i < 9; i++) more = withRingAt(more, largestGapMiddle(more));
    const after = buildTemplate({ measurements: more });

    expect(after.warnings).toEqual([]);
    expect(after.surface!.kind).toBe(before.kind);
    after.surface!.profile.forEach((p, i) => {
      expect(p.height).toBeCloseTo(before.profile[i].height, 9);
      expect(p.radius / before.semiAxes.sideToSide).toBeCloseTo(before.profile[i].radius / before.semiAxes.sideToSide, 6);
    });
  });

  describe("where a narrow ring pinches the top", () => {
    /** Rings by radius, 9 in tall: the third ring is narrow enough that the smoothest profile would point at the top. */
    const pinched = (radius: number): PumpkinMeasurements => ({
      height: 9 * IN,
      rings: [[0.15, 3.5], [0.45, 4.8], [0.66, radius]].map(([position, r]) => ({ position, circumference: 2 * Math.PI * r * IN })),
    });
    const radii = Array.from({ length: 21 }, (_, i) => 2.9 + 0.01 * i);

    it("fits every ring size along the edge, not just some", () => {
      const fitted = radii.filter((r) => fitProfile(pinched(r)).ok);

      expect(fitted).toEqual(radii);
    });

    it.each([2.9, 2.95, 3.0, 3.05])("a ring read off the fit doesn't change the shape (third ring's radius %s in)", (radius) => {
      const m = pinched(radius);
      const before = fitProfile(m);
      let more = m;
      for (let i = 0; i < 9; i++) more = withRingAt(more, largestGapMiddle(more));
      const after = fitProfile(more);

      if (!before.ok || !after.ok) throw new Error("no fit");
      after.profile.forEach((p, i) => expect(p.radius / (4.8 * IN)).toBeCloseTo(before.profile[i].radius / (4.8 * IN), 6));
    });
  });

  it("blends the rings on either side when there is no fitted profile", () => {
    const m = { height: Number.NaN, rings: [{ position: 0.9, circumference: 10 * IN }, { position: 0.1, circumference: 20 * IN }] };

    expect(ringAt(m, 0.5)).toBeCloseTo(15 * IN, 11);
    expect(ringAt(m, 0.3)).toBeCloseTo(17.5 * IN, 11);
  });

  it("copies the one ring next to it below the lowest ring or above the highest when there is no fitted profile", () => {
    const m = { height: 0, rings: [{ position: 0.5, circumference: 30 * IN }, { position: 0.7, circumference: 20 * IN }] };

    expect(ringAt(m, 0.25)).toBe(30 * IN);
    expect(ringAt(m, 0.9)).toBe(20 * IN);
  });
});
