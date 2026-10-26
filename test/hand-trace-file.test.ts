// @vitest-environment jsdom
import svgpath from "svgpath";
import { describe, expect, it } from "vitest";
import type { PhotoFile, PhotoRecord } from "../src/designRecord";
import { createHandTrace, type HandTrace, type HandTraceRecord } from "../src/handTrace";
import { editOnStalePhoto, handTraceFileName, readHandTraceFile, writeHandTraceFile } from "../src/input/handTraceFile";
import { designFromPathData } from "../src/input/pathDesign";
import { readSvgDesign } from "../src/input/svgDesign";
import { expectSameOutlines, outlinesOf } from "./outlines";

/** The loader's tolerance on a blank page (5e-4 of its side). */
const TOL = 5e-4;

/** A hand-trace on a blank page: a square with one curved side, a triangle, and an open shape still being drawn. */
const WORK: HandTraceRecord = {
  shapes: [
    {
      id: 1,
      closed: true,
      mirror: "none",
      points: [
        { x: 0.2, y: 0.2, kind: "corner", out: { x: 0.1, y: -0.1 } },
        { x: 0.6, y: 0.2, kind: "corner", in: { x: -0.1, y: -0.1 } },
        { x: 0.6, y: 0.6, kind: "corner" },
        { x: 0.2, y: 0.6, kind: "corner" },
      ],
    },
    {
      id: 3,
      closed: true,
      mirror: "none",
      points: [
        { x: 0.7, y: 0.7, kind: "corner" },
        { x: 0.9, y: 0.7, kind: "corner" },
        { x: 0.8, y: 0.9, kind: "corner" },
      ],
    },
    { id: 4, closed: false, mirror: "none", points: [{ x: 0.1, y: 0.9, kind: "corner" }, { x: 0.3, y: 0.95, kind: "smooth" }] },
  ],
  drawing: 4,
  done: false,
};

/** The hand-trace `record` reopens as, on a 400 × 400 px canvas. */
function editorOf(record: HandTraceRecord): HandTrace {
  const editor = createHandTrace({ toDesign: designFromPathData, record });
  editor.resize(400, 400);
  return editor;
}

/** `editor`'s hand-trace file, placed `width` mm wide. */
function fileOf(editor: HandTrace, width = 150): string {
  return writeHandTraceFile({
    record: { source: "page", page: editor.page(), handTrace: editor.record() },
    page: editor.page(),
    pathData: editor.pathData(),
    design: editor.design(),
    width,
  });
}

describe("hand-trace file: write then read", () => {
  it("reopens as the same hand-trace: the same record, drawn the same", () => {
    const editor = editorOf(WORK);
    const read = readHandTraceFile(fileOf(editor));
    expect(read).toEqual({ kind: "hand-trace", record: { source: "page", page: { width: 1, height: 1 }, handTrace: WORK } });
    if (read.kind !== "hand-trace" || read.record.source !== "page") return;
    const again = editorOf(read.record.handTrace);
    const { shapes, points, fill, note, pill } = editor.drawn();
    expect(again.drawn()).toMatchObject({ shapes, points, fill, note, pill });
  });

  it("keeps Symmetry and mirrored shapes: reflections drawn as real geometry, the box about the axis, reopening mirrored", () => {
    const twin = { id: 1, closed: true, mirror: "twin" as const, points: WORK.shapes[1].points };
    const half = {
      id: 2,
      closed: true,
      mirror: "symmetric" as const,
      points: [
        { x: 0.5, y: 0.3, kind: "corner" as const },
        { x: 0.3, y: 0.2, kind: "smooth" as const },
        { x: 0.5, y: 0.1, kind: "smooth" as const },
      ],
    };
    const work: HandTraceRecord = { shapes: [twin, half], drawing: null, done: false, symmetry: true };
    const editor = editorOf(work);
    const file = fileOf(editor);
    const read = readHandTraceFile(file);
    expect(read).toEqual({ kind: "hand-trace", record: { source: "page", page: { width: 1, height: 1 }, handTrace: work } });
    // Read as a plain SVG: the twin's reflection and the whole symmetric shape are there, centred on the axis.
    const { design } = readSvgDesign(file);
    expectSameOutlines(design!.paths, editor.design()!.paths, TOL);
    expect(design!.paths).toHaveLength(3);
    expect((design!.bbox.minX + design!.bbox.maxX) / 2).toBeCloseTo(0.5, 6);
  });
});

/** A cleaned-up photo 4:3 wide, as design space has it: one unit across, three quarters of one up. */
const PHOTO_PAGE = { width: 1, height: 0.75 };

/** Opaque fake JPEG bytes, every byte value among them: the file never looks inside. */
const fakeJpeg = (): PhotoFile => ({
  name: "face.jpg",
  type: "image/jpeg",
  bytes: Uint8Array.from({ length: 600 }, (_, i) => (i * 7) % 256).buffer,
});

/** WORK's closed square and open shape, on the 4:3 photo. */
const PHOTO_WORK: HandTraceRecord = { ...WORK, shapes: [WORK.shapes[0], WORK.shapes[2]] };

/**
 * A photo framed with A4 picked and toned, past Cleanup, auto-traced with its own settings, hand-trace chosen and
 * Done: everything a photo's hand-trace file carries.
 */
const photoRecord = (): PhotoRecord => ({
  source: "photo",
  photo: fakeJpeg(),
  cleanup: {
    corners: [
      { x: 0.2, y: 0.15 },
      { x: 0.85, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.15, y: 0.85 },
    ],
    aspect: "a4",
  },
  tone: { brightness: 120, contrast: 150 },
  inCleanup: false,
  autoTrace: { threshold: 140, invert: true, speckle: 5 },
  handTrace: { ...PHOTO_WORK, done: true },
  method: "hand",
  done: true,
});

/** The photo hand-trace `record` reopens as, on a 400 × 400 px canvas. */
function overPhoto(record: HandTraceRecord): HandTrace {
  const editor = createHandTrace({ toDesign: designFromPathData, page: PHOTO_PAGE, photo: true, record });
  editor.resize(400, 400);
  return editor;
}

/** The hand-trace file of `record`'s photo hand-trace. */
function photoFileOf(record: PhotoRecord): string {
  const editor = overPhoto(record.handTrace);
  return writeHandTraceFile({ record, page: editor.page(), pathData: editor.pathData(), design: editor.design(), width: 150 });
}

describe("hand-trace file: a photo's", () => {
  it("reopens with its photo, frame, tone, auto-trace settings, method, shapes, open shapes and Done", () => {
    const read = readHandTraceFile(photoFileOf(photoRecord()));
    expect(read).toEqual({ kind: "hand-trace", record: photoRecord() });
    if (read.kind !== "hand-trace" || read.record.source !== "photo") return;
    // toEqual doesn't look inside an ArrayBuffer: compare the photo's bytes themselves.
    expect(new Uint8Array(read.record.photo.bytes)).toEqual(new Uint8Array(photoRecord().photo.bytes));
  });

  it("with only open shapes, draws nothing and no image, spans the photo, and still reopens", () => {
    const open = { ...photoRecord(), handTrace: { shapes: [WORK.shapes[2]], drawing: 4, done: false } };
    const text = photoFileOf(open);
    const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    expect([svg.querySelector("path"), svg.querySelector("image")]).toEqual([null, null]);
    expect(svg.getAttribute("viewBox")).toBe("0 -0.75 1 0.75");
    expect(svg.getAttribute("height")).toBe("112.5mm");
    expect(readHandTraceFile(text)).toMatchObject({ kind: "hand-trace", record: { source: "photo", handTrace: open.handTrace } });
  });

  it("a photo that isn't readable in the record loads as a plain SVG design, with a note", () => {
    const text = withRecord(photoFileOf(photoRecord()), (r) => ({ ...r, photo: { name: "face.jpg", type: "image/jpeg", base64: "%%" } }));
    expect(readHandTraceFile(text)).toMatchObject({ kind: "svg", notes: [expect.stringContaining("can't be read")] });
  });
});

/** `text` with its visible path's `d` changed by `change`, as another program would save it. */
function withPath(text: string, change: (d: string) => string): string {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const path = doc.querySelector("path")!;
  path.setAttribute("d", change(path.getAttribute("d")!));
  return new XMLSerializer().serializeToString(doc);
}

describe("hand-trace file: changed in another program", () => {
  it("path text rewritten without moving anything (absolute to relative) still reopens as the hand-trace", () => {
    const text = withPath(fileOf(editorOf(WORK)), (d) => svgpath(d).rel().toString());
    expect(readHandTraceFile(text)).toMatchObject({ kind: "hand-trace", record: { handTrace: WORK } });
  });

  /** WORK with the square's third point moved right by `by` (page units). */
  const moved = (by: number): HandTraceRecord => ({
    ...WORK,
    shapes: WORK.shapes.map((s) => (s.id === 1 ? { ...s, points: s.points.map((p, i) => (i === 2 ? { ...p, x: p.x + by } : p)) } : s)),
  });

  it("a moved point loads as an SVG design of the drawing as it is now, with a note saying why", () => {
    const changed = editorOf(moved(0.05));
    const read = readHandTraceFile(withPath(fileOf(editorOf(WORK)), () => changed.pathData()));
    expect(read).toMatchObject({
      kind: "svg",
      notes: ["This file was changed in another program, so it opens as plain shapes, not as an editable hand-trace."],
    });
    if (read.kind !== "svg") return;
    expectSameOutlines(read.design!.paths, changed.design()!.paths, TOL);
  });

  it("a point moved by well under the loader's tolerance still reopens as the hand-trace", () => {
    const text = withPath(fileOf(editorOf(WORK)), () => editorOf(moved(TOL / 10)).pathData());
    expect(readHandTraceFile(text).kind).toBe("hand-trace");
  });

  it("an added shape loads as an SVG design with the note", () => {
    const text = withPath(fileOf(editorOf(WORK)), (d) => `${d}M0.05 -0.05L0.1 -0.05L0.1 -0.1Z`);
    expect(readHandTraceFile(text)).toMatchObject({ kind: "svg", notes: [expect.stringContaining("changed in another program")] });
  });

  it("a stale record still widens the box to the viewBox: the loaded design's box is the union of both", () => {
    // The viewBox is the hand-trace's box. The program left only the triangle, and added a square past its right.
    const triangle = editorOf({ ...WORK, shapes: [WORK.shapes[1]] }).pathData();
    const read = readHandTraceFile(withPath(fileOf(editorOf(WORK)), () => `${triangle}M1 -0.1L1.1 -0.1L1.1 -0.2L1 -0.2Z`));
    if (read.kind !== "svg") throw new Error("expected an SVG design");
    const all = editorOf(WORK).design()!.bbox;
    expect(read.design!.bbox).toEqual({ minX: all.minX, minY: 0.1, maxX: 1.1, maxY: all.maxY });
  });
});

describe("hand-trace file: Edit as hand-trace on a changed one", () => {
  /** PHOTO_WORK with the square's third point moved right, drawn as another program saved it over the photo's file. */
  const changed = () => {
    const shapes = PHOTO_WORK.shapes.map((s) =>
      s.id === 1 ? { ...s, points: s.points.map((p, i) => (i === 2 ? { ...p, x: p.x + 0.05 } : p)) } : s,
    );
    const editor = overPhoto({ ...PHOTO_WORK, shapes });
    return { editor, text: withPath(photoFileOf(photoRecord()), () => editor.pathData()) };
  };

  it("a moved point loads as an SVG design, and editing it reuses the stale record's photo, cleanup and auto-trace side", () => {
    const { text } = changed();
    expect(readHandTraceFile(text)).toMatchObject({ kind: "svg", notes: [expect.stringContaining("changed in another program")] });
    const edited = editOnStalePhoto(text)!;
    const { photo, cleanup, tone, autoTrace, method } = photoRecord();
    expect(edited).toMatchObject({ source: "photo", photo: { name: photo.name, type: photo.type }, cleanup, tone, autoTrace, method });
    expect(new Uint8Array(edited.photo.bytes)).toEqual(new Uint8Array(photo.bytes));
  });

  it("takes the shapes from the visible path, where they are on the photo, without the record's open shapes", () => {
    const { editor, text } = changed();
    const { handTrace } = editOnStalePhoto(text)!;
    expect(handTrace).toMatchObject({ drawing: null, done: false });
    expect(handTrace.shapes.map((s) => [s.closed, s.mirror])).toEqual([[true, "none"]]);
    expectSameOutlines(overPhoto(handTrace).design()!.paths, editor.design()!.paths, TOL);
  });

  it("lands on the canvas, not in Cleanup, and not Done", () => {
    const { text } = changed();
    expect(editOnStalePhoto(withRecord(text, (r) => ({ ...r, inCleanup: true })))).toMatchObject({ inCleanup: false, done: false });
  });

  it("a blank page's changed file has no photo to reuse: it converts as any SVG design", () => {
    const text = withPath(fileOf(editorOf(WORK)), (d) => `${d}M0.05 -0.05L0.1 -0.05L0.1 -0.1Z`);
    expect(editOnStalePhoto(text)).toBeNull();
  });

  it("a record whose photo can't be read has none to reuse", () => {
    const text = withRecord(changed().text, (r) => ({ ...r, photo: { name: "face.jpg", type: "image/jpeg", base64: "%%" } }));
    expect(editOnStalePhoto(text)).toBeNull();
  });
});

/** `text` with the record's JSON changed by `change`. */
function withRecord(text: string, change: (record: Record<string, unknown>) => unknown): string {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const metadata = doc.querySelector("metadata")!.firstElementChild!;
  metadata.textContent = JSON.stringify(change(JSON.parse(metadata.textContent) as Record<string, unknown>));
  return new XMLSerializer().serializeToString(doc);
}

describe("hand-trace file: records this version can't reopen", () => {
  const svgOf = (text: string) => {
    const read = readHandTraceFile(text);
    if (read.kind !== "svg") throw new Error("expected an SVG design");
    expectSameOutlines(read.design!.paths, editorOf(WORK).design()!.paths, TOL);
    return read.notes;
  };

  it("an unknown version loads as a plain SVG design, with a note of its own", () => {
    const notes = svgOf(withRecord(fileOf(editorOf(WORK)), (r) => ({ ...r, version: 2 })));
    expect(notes).toEqual([expect.stringContaining("another version of this app")]);
  });

  it("an invalid record loads as a plain SVG design, with a note of its own", () => {
    const shapes = [{ id: 1, closed: true, mirror: "none", points: [{ x: 0, y: 0 }] }];
    const notes = svgOf(withRecord(fileOf(editorOf(WORK)), (r) => ({ ...r, handTrace: { shapes, drawing: null, done: false } })));
    expect(notes).toEqual([expect.stringContaining("can't be read")]);
  });

  it("a record without its fingerprint is invalid", () => {
    const notes = svgOf(withRecord(fileOf(editorOf(WORK)), ({ fingerprint: _, ...r }) => r));
    expect(notes).toEqual([expect.stringContaining("can't be read")]);
  });

  it("with the metadata stripped it loads as a plain SVG design, with no note", () => {
    const doc = new DOMParser().parseFromString(fileOf(editorOf(WORK)), "image/svg+xml");
    doc.querySelector("metadata")!.remove();
    expect(svgOf(new XMLSerializer().serializeToString(doc))).toEqual([]);
  });
});

describe("hand-trace file: what other programs see", () => {
  it("the visible path, read by the SVG loader, is the hand-trace's Design, sized in mm at the placed Width", () => {
    const editor = editorOf(WORK);
    const text = fileOf(editor, 200);
    const read = readSvgDesign(text);
    expectSameOutlines(read.design!.paths, editor.design()!.paths, TOL);
    const { minX, minY, maxX, maxY } = editor.design()!.bbox;
    const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    const viewBox = svg.getAttribute("viewBox")!.split(" ").map(Number);
    [minX, -maxY, maxX - minX, maxY - minY].forEach((v, i) => expect(viewBox[i]).toBeCloseTo(v, 9));
    expect(svg.getAttribute("width")).toBe("200mm");
    expect(parseFloat(svg.getAttribute("height")!)).toBeCloseTo((200 * (maxY - minY)) / (maxX - minX), 2);
    expect(svg.getAttribute("height")).toMatch(/mm$/);
  });

  it("draws one compound path filled even-odd, leaving out open shapes, and no image", () => {
    const svg = new DOMParser().parseFromString(fileOf(editorOf(WORK)), "image/svg+xml").documentElement;
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect([paths[0].getAttribute("fill"), paths[0].getAttribute("fill-rule")]).toEqual(["black", "evenodd"]);
    expect(outlinesOf(paths[0].getAttribute("d")!, TOL)).toHaveLength(2);
    expect(svg.querySelector("image")).toBeNull();
  });

  it("a hand-trace with only open shapes still reopens, with nothing drawn", () => {
    const open: HandTraceRecord = { shapes: [WORK.shapes[2]], drawing: null, done: true };
    const text = fileOf(editorOf(open));
    expect(new DOMParser().parseFromString(text, "image/svg+xml").querySelector("path")).toBeNull();
    expect(readHandTraceFile(text)).toMatchObject({ kind: "hand-trace", record: { handTrace: open } });
  });

  it("a blank page's file is named for the day it's downloaded", () => {
    expect(handTraceFileName(new Date(2026, 9, 5, 23, 30))).toBe("hand-trace-2026-10-05.svg");
  });

  it.each([
    ["face.jpg", "face-hand-trace.svg"],
    ["my.face.photo.JPEG", "my.face.photo-hand-trace.svg"],
    ["face-hand-trace.jpg", "face-hand-trace.svg"],
    ["noextension", "noextension-hand-trace.svg"],
  ])("a photo's file is named for the photo: %s gives %s", (photo, file) => {
    expect(handTraceFileName(new Date(2026, 9, 5), photo)).toBe(file);
  });

  it.each([
    ["cat.svg", "cat-hand-trace.svg"],
    ["cat-hand-trace.svg", "cat-hand-trace.svg"],
  ])("an edited SVG design's file is named for the SVG file: %s gives %s", (svg, file) => {
    expect(handTraceFileName(new Date(2026, 9, 5), svg)).toBe(file);
  });

  it("a hand-trace made from an SVG design reopens with that file's name and its page", () => {
    const editor = createHandTrace({ toDesign: designFromPathData, page: { width: 1, height: 0.5 }, record: WORK });
    const record = { source: "page", page: editor.page(), handTrace: editor.record(), name: "cat.svg" } as const;
    const text = writeHandTraceFile({ record, page: editor.page(), pathData: editor.pathData(), design: editor.design(), width: 150 });
    expect(readHandTraceFile(text)).toEqual({ kind: "hand-trace", record });
  });
});
