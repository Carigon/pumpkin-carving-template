import { describe, expect, it } from "vitest";
import {
  applyHomography,
  carryPoints,
  cleanUp,
  cornerAt,
  designToPhoto,
  exifFocal35Mm,
  isFrame,
  moveCorner,
  photoPage,
  rotateFrame,
  START_FRAME,
  turnFrame,
  warpPhoto,
  WHOLE_PHOTO,
  type FrameCorners,
} from "../src/input/cleanupFrame";

/** A 4:3 phone photo's size in px. */
const PHOTO = { width: 4000, height: 3000 };

/** Frame corners at these photo px, as fractions of `PHOTO`. */
function cornersAt(...px: [number, number][]): FrameCorners {
  return px.map(([x, y]) => ({ x: x / PHOTO.width, y: y / PHOTO.height })) as unknown as FrameCorners;
}

/**
 * The frame corners on a 600 × 1000 mm board (not a paper size), tilted 35° away and turned 10°, `distance` mm in
 * front of a camera of `focal35` mm-equivalent focal length, as it shows in `PHOTO`.
 */
function board(focal35: number, distance: number): FrameCorners {
  const focal = (focal35 * Math.hypot(PHOTO.width, PHOTO.height)) / Math.hypot(36, 24);
  const [tilt, turn] = [(35 * Math.PI) / 180, (10 * Math.PI) / 180];
  const seen = ([x, y]: [number, number]): [number, number] => {
    const [x1, z1] = [x * Math.cos(turn), -x * Math.sin(turn)]; // turned about its own vertical centre line
    const [y2, z2] = [y * Math.cos(tilt) - z1 * Math.sin(tilt), distance + y * Math.sin(tilt) + z1 * Math.cos(tilt)];
    return [PHOTO.width / 2 + (focal * x1) / z2, PHOTO.height / 2 + (focal * y2) / z2];
  };
  return cornersAt(...([[-300, -500], [300, -500], [300, 500], [-300, 500]] as [number, number][]).map(seen));
}

describe("the cleanup frame: the homography and output size", () => {
  it("the frame corners land on the cleaned-up photo's corners", () => {
    const corners = cornersAt([900, 400], [3100, 650], [2900, 2700], [700, 2500]);
    const { homography, width, height } = cleanUp({ corners, aspect: null }, PHOTO);
    const landed = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ].map(([x, y]) => applyHomography(homography, x, y));
    const expected = [
      [900, 400],
      [3100, 650],
      [2900, 2700],
      [700, 2500],
    ];
    landed.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i][0], 6);
      expect(p.y).toBeCloseTo(expected[i][1], 6);
    });
  });

  it("a hand-trace's design space over the cleaned-up photo is one unit wide, with the photo's shape", () => {
    const portrait = cornersAt([1000, 300], [2400, 300], [2400, 2700], [1000, 2700]);
    const page = photoPage(cleanUp({ corners: portrait, aspect: "a4" }, PHOTO));
    expect(page.width).toBe(1);
    expect(page.height).toBeCloseTo(297 / 210, 3);
  });
});

describe("the cleanup frame: the aspect estimate", () => {
  it("a sheet of A4 photographed straight on snaps to A4", () => {
    // 1200 × 1697 px is 210 × 297 to the nearest px, off the photo's centre.
    const corners = cornersAt([500, 200], [1700, 200], [1700, 1897], [500, 1897]);
    const cleaned = cleanUp({ corners, aspect: null }, PHOTO);
    expect(cleaned.aspect).toBe("a4");
    expect(cleaned.width / cleaned.height).toBeCloseTo(210 / 297, 2);
  });

  it("the orientation follows the frame: A4 on its side comes out landscape", () => {
    const corners = cornersAt([500, 200], [2197, 200], [2197, 1400], [500, 1400]);
    const cleaned = cleanUp({ corners, aspect: null }, PHOTO);
    expect(cleaned.aspect).toBe("a4");
    expect(cleaned.width / cleaned.height).toBeCloseTo(297 / 210, 2);
  });

  it("a sheet photographed at an angle recovers its true aspect", () => {
    const cleaned = cleanUp({ corners: board(25, 1600), aspect: null }, PHOTO);
    expect(cleaned.aspect).toBe("estimated");
    expect(cleaned.width / cleaned.height).toBeCloseTo(0.6, 2);
  });

  it("a photo's own focal length, from its EXIF, replaces the phone's assumed one", () => {
    const zoomed = board(70, 4500);
    const known = cleanUp({ corners: zoomed, aspect: "estimated" }, PHOTO, 70);
    expect(known.width / known.height).toBeCloseTo(0.6, 2);
    const assumed = cleanUp({ corners: zoomed, aspect: "estimated" }, PHOTO);
    expect(Math.abs(assumed.width / assumed.height - 0.6)).toBeGreaterThan(0.01);
  });

  it("a picked aspect chip wins over the estimate", () => {
    const corners = cornersAt([500, 200], [1700, 200], [1700, 1897], [500, 1897]);
    const cleaned = cleanUp({ corners, aspect: "square" }, PHOTO);
    expect(cleaned.aspect).toBe("square");
    expect(cleaned.width).toBe(cleaned.height);
  });
});

describe("the cleanup frame: dragging a frame corner", () => {
  it("the frame starts 10% in from the photo's corners", () => {
    expect(START_FRAME).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]);
  });

  it("a corner goes where it's dragged while the frame stays convex", () => {
    expect(moveCorner(START_FRAME, 2, { x: 0.95, y: 0.7 }, PHOTO)[2]).toEqual({ x: 0.95, y: 0.7 });
  });

  it("a corner dragged off the photo stays on its edge", () => {
    expect(moveCorner(START_FRAME, 0, { x: -0.5, y: 0.3 }, PHOTO)[0]).toEqual({ x: 0, y: 0.3 });
    expect(moveCorner(START_FRAME, 2, { x: 1.2, y: 1.4 }, PHOTO)[2]).toEqual({ x: 1, y: 1 });
  });

  it("a corner dragged across the frame stops before the frame turns concave", () => {
    // The top-left corner dragged toward the bottom-right one: it crosses the line between its neighbours at x + y = 1.
    const [tl] = moveCorner(START_FRAME, 0, { x: 0.8, y: 0.8 }, PHOTO);
    expect(tl.x).toBeCloseTo(tl.y, 9);
    expect(tl.x + tl.y).toBeLessThan(1);
    expect(tl.x + tl.y).toBeGreaterThan(0.9);
  });

  it("a corner dragged onto its neighbour stops short of it", () => {
    const [tl] = moveCorner(START_FRAME, 0, { x: 0.95, y: 0.1 }, PHOTO);
    expect(tl.y).toBe(0.1);
    expect(tl.x).toBeGreaterThan(0.5);
    expect(tl.x).toBeLessThan(0.9);
  });

  it("a press grabs the nearest corner within reach, or none", () => {
    // Reach is in photo px: 40 px is 1% of the photo's width.
    expect(cornerAt(START_FRAME, { x: 0.905, y: 0.1 }, PHOTO, 40)).toBe(1);
    expect(cornerAt(START_FRAME, { x: 0.5, y: 0.5 }, PHOTO, 40)).toBeNull();
    expect(cornerAt(START_FRAME, { x: 0.1, y: 0.92 }, PHOTO, 40)).toBeNull(); // 60 px below the corner
  });

  it("a stopped frame is still a frame", () => {
    for (const to of [{ x: 0.8, y: 0.8 }, { x: 0.95, y: 0.1 }, { x: 1, y: 1 }, { x: 0.9, y: 0.5 }])
      expect(isFrame(moveCorner(START_FRAME, 0, to, PHOTO))).toBe(true);
  });
});

describe("the cleanup frame: Turn", () => {
  it("turns all four corners about their centre", () => {
    // A square frame in the middle of a square photo, turned 30° clockwise on screen (y down).
    const square = { width: 1000, height: 1000 };
    const small: FrameCorners = [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.7, y: 0.7 },
      { x: 0.3, y: 0.7 },
    ];
    const { corners, degrees } = turnFrame(small, 30, square);
    expect(degrees).toBe(30);
    const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const expected = small.map(({ x, y }) => ({ x: 0.5 + (x - 0.5) * c - (y - 0.5) * s, y: 0.5 + (x - 0.5) * s + (y - 0.5) * c }));
    corners.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 9);
      expect(p.y).toBeCloseTo(expected[i].y, 9);
    });
  });

  it("stops when a corner would leave the photo", () => {
    // The 10% inset frame on a square photo: a corner, 0.4·√2 from the centre, reaches the edge at 0.5 from it,
    // after turning 45° − acos(0.5 / (0.4·√2)) ≈ 17.9°.
    const square = { width: 1000, height: 1000 };
    const { corners, degrees } = turnFrame(START_FRAME, -45, square);
    expect(degrees).toBeCloseTo(-(45 - (Math.acos(0.5 / (0.4 * Math.SQRT2)) * 180) / Math.PI), 1);
    for (const p of corners) for (const v of [p.x, p.y]) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe("the cleanup frame: Rotate 90°", () => {
  const corners = cornersAt([900, 400], [3100, 650], [2900, 2700], [700, 2500]);

  it("turns the cleaned-up photo a quarter turn clockwise: its new top-left is the old bottom-left", () => {
    const turned = rotateFrame(corners);
    expect(turned).toEqual([corners[3], corners[0], corners[1], corners[2]]);
    const before = cleanUp({ corners, aspect: null }, PHOTO);
    const after = cleanUp({ corners: turned, aspect: null }, PHOTO);
    expect([after.width, after.height]).toEqual([before.height, before.width]);
  });

  it("four times is a no-op", () => {
    expect(rotateFrame(rotateFrame(rotateFrame(rotateFrame(corners))))).toEqual(corners);
  });
});

describe("the cleanup frame: the camera's focal length from the photo's EXIF", () => {
  /** A JPEG's first bytes: start of image, then an EXIF segment whose sub-IFD has a 35 mm focal length tag. */
  function jpegWithFocal(focal35: number, littleEndian: boolean): ArrayBuffer {
    const tiff = new DataView(new ArrayBuffer(8 + 18 + 18));
    const u16 = (at: number, v: number) => tiff.setUint16(at, v, littleEndian);
    const u32 = (at: number, v: number) => tiff.setUint32(at, v, littleEndian);
    u16(0, littleEndian ? 0x4949 : 0x4d4d);
    u16(2, 42);
    u32(4, 8); // IFD0 right after the header
    u16(8, 1); // one entry: the EXIF sub-IFD's offset (tag, type LONG, count 1, value)
    u16(10, 0x8769);
    u16(12, 4);
    u32(14, 1);
    u32(18, 26);
    u32(22, 0); // no next IFD
    u16(26, 1); // one entry: FocalLengthIn35mmFilm (tag, type SHORT, count 1, value)
    u16(28, 0xa405);
    u16(30, 3);
    u32(32, 1);
    u16(36, focal35);
    u32(40, 0);
    const app1 = [..."Exif"].map((c) => c.charCodeAt(0)).concat(0, 0, ...new Uint8Array(tiff.buffer));
    const length = app1.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xd9]).buffer;
  }

  it.each([
    ["big-endian", false],
    ["little-endian", true],
  ])("reads the 35 mm-equivalent focal length (%s)", (_, littleEndian) => {
    expect(exifFocal35Mm(jpegWithFocal(26, littleEndian))).toBe(26);
  });

  it.each([
    ["a JPEG with no EXIF", new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]).buffer],
    ["a PNG", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer],
    ["a cut-off file", jpegWithFocal(26, false).slice(0, 30)],
    ["a focal length of 0 (unknown)", jpegWithFocal(0, true)],
  ])("knows nothing from %s", (_, bytes) => {
    expect(exifFocal35Mm(bytes)).toBeUndefined();
  });
});

describe("the cleanup frame: the warp", () => {
  /** Checker cells' side in px. */
  const CELL = 8;
  const photo = { width: 48, height: 40 };
  /** A checkerboard photo: black where the cell's row and column add up to even, white elsewhere. */
  const checker = { ...photo, data: new Uint8ClampedArray(photo.width * photo.height * 4) };
  const shade = (x: number, y: number) => ((Math.floor(x / CELL) + Math.floor(y / CELL)) % 2 === 0 ? 0 : 255);
  for (let y = 0; y < photo.height; y++)
    for (let x = 0; x < photo.width; x++) checker.data.set([shade(x, y), shade(x, y), shade(x, y), 255], (y * photo.width + x) * 4);

  it("each pixel of the cleaned-up photo shows the photo where the homography takes it", () => {
    const corners: FrameCorners = [
      { x: 0.1, y: 0.15 },
      { x: 0.85, y: 0.05 },
      { x: 0.95, y: 0.9 },
      { x: 0.05, y: 0.8 },
    ];
    const { homography, width, height } = cleanUp({ corners, aspect: null }, photo);
    const out = warpPhoto(checker, homography, width, height);
    expect(out.length).toBe(width * height * 4);
    let checked = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = applyHomography(homography, x + 0.5, y + 0.5);
        const [u, v] = [at.x % CELL, at.y % CELL];
        if (u < 1 || u > CELL - 1 || v < 1 || v > CELL - 1) continue; // within a pixel of a cell's edge: blended
        const s = shade(at.x, at.y);
        expect(Array.from(out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))).toEqual([s, s, s, 255]);
        checked++;
      }
    expect(checked).toBeGreaterThan((width * height) / 2);
  });

  it("a known pixel lands where the homography says", () => {
    // The whole photo turned a quarter turn: the photo's top-right cell (white) is the cleaned-up top-left.
    const whole: FrameCorners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const { homography, width, height } = cleanUp({ corners: rotateFrame(rotateFrame(rotateFrame(whole))), aspect: "estimated" }, photo);
    expect([width, height]).toEqual([40, 48]);
    const out = warpPhoto(checker, homography, width, height);
    expect(Array.from(out.subarray(0, 4))).toEqual([255, 255, 255, 255]);
    const at = applyHomography(homography, 0.5, 0.5);
    expect(at.x).toBeCloseTo(47.5, 9);
    expect(at.y).toBeCloseTo(0.5, 9);
  });
});

describe("the cleanup frame: carrying a hand-trace's points through a cleanup change", () => {
  /** A small photo, so no cleaned-up photo is shrunk (or rounded) on the way. */
  const small = { width: 400, height: 300 };
  const whole = cleanUp({ corners: WHOLE_PHOTO, aspect: "estimated" }, small);
  /** The photo's right half, cropped: 200 × 300 px. */
  const rightHalf = cleanUp(
    {
      corners: [
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0.5, y: 1 },
      ],
      aspect: "estimated",
    },
    small,
  );

  it("a design-space position is on the photo where the cleaned-up photo shows it: its top-left at the frame's", () => {
    const tl = designToPhoto(rightHalf, { x: 0, y: photoPage(rightHalf).height });
    expect(tl.x).toBeCloseTo(200, 9);
    expect(tl.y).toBeCloseTo(0, 9);
    const middle = designToPhoto(whole, { x: 0.5, y: 0.375 });
    expect(middle.x).toBeCloseTo(200, 9);
    expect(middle.y).toBeCloseTo(150, 9);
  });

  it("a crop carries a point to where the same spot of the photo is in the new design space", () => {
    // Photo px (300, 75): a quarter of the way down the whole photo's right half.
    const carried = carryPoints(whole, rightHalf)({ x: 0.75, y: 0.5625 });
    expect(carried.x).toBeCloseTo(0.5, 9);
    expect(carried.y).toBeCloseTo(1.125, 9);
  });

  it("under a four-corner change a point stays on its spot of the photo, and comes back where it started", () => {
    const tilted = cleanUp({ corners: cornersAt([900, 400], [3100, 650], [2900, 2700], [700, 2500]), aspect: null }, PHOTO);
    const straight = cleanUp({ corners: START_FRAME, aspect: null }, PHOTO);
    const p = { x: 0.3, y: 0.4 };
    const there = carryPoints(tilted, straight)(p);
    const spot = [designToPhoto(tilted, p), designToPhoto(straight, there)];
    expect(spot[1].x).toBeCloseTo(spot[0].x, 6);
    expect(spot[1].y).toBeCloseTo(spot[0].y, 6);
    const back = carryPoints(straight, tilted)(there);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});
