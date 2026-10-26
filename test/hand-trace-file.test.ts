// @vitest-environment jsdom
import svgpath from "svgpath";
import { describe, expect, it } from "vitest";
import { createHandTrace, type HandTrace, type HandTraceRecord } from "../src/handTrace";
import { handTraceFileName, readHandTraceFile, writeHandTraceFile } from "../src/input/handTraceFile";
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
});
