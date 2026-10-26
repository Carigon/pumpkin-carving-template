import { describe, expect, it, vi } from "vitest";
import { createRecordKeeper, type DesignRecord, type PhotoFile, type RecordStorage } from "../src/designRecord";

/** IndexedDB's slot, in memory: values are structured-cloned in and out, as IndexedDB does. */
function memoryStorage(): RecordStorage {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(structuredClone(data.get(key))),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

/** A shrink that's never needed. */
const noShrink = () => Promise.reject(new Error("not expected"));

/** A blank page with a closed triangle and an open shape still being drawn, Done not pressed. */
const pageRecord: DesignRecord = {
  source: "page",
  page: { width: 1, height: 1 },
  handTrace: {
    shapes: [
      {
        id: 1,
        closed: true,
        mirror: "none",
        points: [
          { x: 0.2, y: 0.2, kind: "corner" },
          { x: 0.8, y: 0.2, kind: "smooth", in: { x: -0.1, y: 0 }, out: { x: 0.1, y: 0 } },
          { x: 0.5, y: 0.7, kind: "corner" },
        ],
      },
      { id: 3, closed: false, mirror: "none", points: [{ x: 0.1, y: 0.9, kind: "corner" }] },
    ],
    drawing: 3,
    done: false,
  },
};

/** `storage`, counting how many times a photo is written to it. */
function counting(storage: RecordStorage): RecordStorage & { photoWrites(): number } {
  let writes = 0;
  return {
    ...storage,
    set(key, value) {
      if (key === "photo") writes++;
      return storage.set(key, value);
    },
    photoWrites: () => writes,
  };
}

/** `storage` with room for a photo of at most `bytes`, refusing a bigger one as a full IndexedDB does. */
function limited(storage: RecordStorage, bytes: number): RecordStorage {
  return {
    ...storage,
    set(key, value) {
      const photo = (value as { photo?: PhotoFile }).photo;
      if (photo && photo.bytes.byteLength > bytes) return Promise.reject(new DOMException("Full", "QuotaExceededError"));
      return storage.set(key, value);
    },
  };
}

/** Storage that refuses everything, as when the browser blocks it. */
function blocked(): RecordStorage {
  const refuse = () => Promise.reject(new DOMException("Blocked", "SecurityError"));
  return { get: refuse, set: refuse, delete: refuse };
}

/** Opaque fake JPEG bytes: the record never looks inside. */
function fakeJpeg(size: number): PhotoFile {
  return { name: "face.jpg", type: "image/jpeg", bytes: new Uint8Array(size).fill(7).buffer };
}

/**
 * A photo, framed with A4 picked and toned, past Cleanup: auto-traced with its settings and accepted, with a
 * hand-trace kept beside it.
 */
const photoRecord = {
  source: "photo",
  photo: fakeJpeg(64),
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
  autoTrace: { threshold: 140, invert: false, speckle: 5 },
  handTrace: pageRecord.handTrace,
  method: "auto",
  done: true,
} satisfies DesignRecord;

/** An SVG design, before any Edit as hand-trace: kept as its file. */
const svgRecord: DesignRecord = {
  source: "svg",
  svg: { name: "cat.svg", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="2"/></svg>' },
};

describe("the record module", () => {
  it("a kept record comes back after a reload", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(pageRecord);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(pageRecord);
  });

  it("a record of another version restores nothing", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(pageRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), version: 2 });
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it("nothing kept restores nothing", async () => {
    expect(await createRecordKeeper(memoryStorage(), noShrink).restore()).toBeNull();
  });

  const point = { x: 0.5, y: 0.5, kind: "corner" };
  const shape = { id: 1, closed: false, mirror: "none", points: [point] };
  it.each([
    ["shapes that aren't a list", { shapes: "triangle", drawing: null, done: false }],
    ["a point off the number line", { shapes: [{ ...shape, points: [{ ...point, x: Number.NaN }] }], drawing: null, done: false }],
    ["a point of an unknown kind", { shapes: [{ ...shape, points: [{ ...point, kind: "cusp" }] }], drawing: null, done: false }],
    ["a handle without a y", { shapes: [{ ...shape, points: [{ ...point, out: { x: 0.1 } }] }], drawing: null, done: false }],
    ["an unknown mirror", { shapes: [{ ...shape, mirror: "left" }], drawing: null, done: false }],
    ["a shape with no points", { shapes: [{ ...shape, points: [] }], drawing: null, done: false }],
    ["a closed shape of 2 points", { shapes: [{ ...shape, closed: true, points: [point, point] }], drawing: null, done: false }],
    ["two shapes with one id", { shapes: [shape, shape], drawing: null, done: false }],
    ["no hand-trace at all", undefined],
  ])("an invalid hand-trace (%s) restores empty, on the same page", async (_, handTrace) => {
    const storage = memoryStorage();
    await storage.set("work", { version: 1, source: "page", page: { width: 2, height: 1 }, handTrace });
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual({
      source: "page",
      page: { width: 2, height: 1 },
      handTrace: { shapes: [], drawing: null, done: false },
    });
  });

  it("a photo comes back as the file as chosen, with its tone, both methods' work, the chosen one and Done", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(photoRecord);
  });

  it("a photo hand-traced and left in Cleanup comes back hand-traced and in Cleanup", async () => {
    const storage = memoryStorage();
    const straightening = { ...photoRecord, method: "hand", inCleanup: true, done: false } satisfies DesignRecord;
    await createRecordKeeper(storage, noShrink).keep(straightening);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(straightening);
  });

  it("an invalid hand-trace on a photo restores empty, while the photo, its cleanup and auto-trace survive", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), handTrace: { shapes: [{ id: 1 }] } });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, handTrace: { shapes: [], drawing: null, done: false } });
  });

  it.each([
    ["a brightness out of range", { brightness: 1000 }, { brightness: 100 }],
    ["a contrast that isn't a number", { contrast: "high" }, { contrast: 100 }],
  ])("an invalid tone (%s) falls back to its default, the other kept", async (_, bad, fallback) => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), tone: { ...photoRecord.tone, ...bad } });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, tone: { ...photoRecord.tone, ...fallback } });
  });

  it("a photo kept with no tone, method or stage comes back untoned, on hand-trace, past Cleanup", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    const { tone: _, method: __, inCleanup: ___, ...rest } = (await storage.get("work")) as Record<string, unknown>;
    await storage.set("work", rest);
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, tone: { brightness: 100, contrast: 100 }, method: "hand", inCleanup: false });
  });

  it("an unknown tracing method falls back to hand-trace, a new photo's", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), method: "potrace" });
    expect(await createRecordKeeper(storage, noShrink).restore()).toMatchObject({ method: "hand" });
  });

  it("the photo is written once, when loaded; later changes write only the rest", async () => {
    const storage = counting(memoryStorage());
    const keeper = createRecordKeeper(storage, noShrink);
    await keeper.keep(photoRecord);
    await keeper.keep({ ...photoRecord, autoTrace: { threshold: 90, invert: true, speckle: 0 } });
    await keeper.keep({ ...photoRecord, done: false });
    expect(storage.photoWrites()).toBe(1);
    expect(await createRecordKeeper(storage, noShrink).restore()).toMatchObject({ done: false });
  });

  it("a restored photo isn't written again when the work on it changes", async () => {
    const storage = counting(memoryStorage());
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    const keeper = createRecordKeeper(storage, noShrink);
    const restored = await keeper.restore();
    if (restored?.source !== "photo") throw new Error("the photo didn't come back");
    await keeper.keep({ ...restored, done: false });
    expect(storage.photoWrites()).toBe(1);
  });

  it.each([
    ["a threshold out of range", { threshold: 300 }, { threshold: 128 }],
    ["a fractional speckle", { speckle: 2.5 }, { speckle: 2 }],
    ["an invert that isn't a yes or no", { invert: "yes" }, { invert: false }],
  ])("an invalid auto-trace setting (%s) falls back to its default, the others kept", async (_, bad, fallback) => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), autoTrace: { ...photoRecord.autoTrace, ...bad } });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, autoTrace: { ...photoRecord.autoTrace, ...fallback } });
  });

  it("auto-trace settings that aren't there at all fall back to the defaults", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), autoTrace: null });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, autoTrace: { threshold: 128, invert: false, speckle: 2 } });
  });

  /** Where a new photo's frame starts, and what an invalid kept one falls back to. */
  const startFrame = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const { corners } = photoRecord.cleanup;
  it.each([
    ["three corners", { corners: corners.slice(0, 3) }, { corners: startFrame }],
    ["a corner off the photo", { corners: [{ x: -0.1, y: 0.15 }, ...corners.slice(1)] }, { corners: startFrame }],
    ["a corner that isn't a number", { corners: [{ x: "left", y: 0.15 }, ...corners.slice(1)] }, { corners: startFrame }],
    ["a self-crossing frame", { corners: [corners[1], corners[0], corners[2], corners[3]] }, { corners: startFrame }],
    ["an unknown aspect", { aspect: "legal" }, { aspect: null }],
  ])("an invalid cleanup (%s) falls back to its default, the rest kept", async (_, bad, fallback) => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), cleanup: { ...photoRecord.cleanup, ...bad } });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, cleanup: { ...photoRecord.cleanup, ...fallback } });
  });

  it("a cleanup that isn't there at all falls back to a new photo's", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    await storage.set("work", { ...((await storage.get("work")) as object), cleanup: undefined });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...photoRecord, cleanup: { corners: startFrame, aspect: null } });
  });

  it("the snapped estimate (no aspect chip picked) is kept as such", async () => {
    const storage = memoryStorage();
    const estimated = { ...photoRecord, cleanup: { ...photoRecord.cleanup, aspect: null } };
    await createRecordKeeper(storage, noShrink).keep(estimated);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(estimated);
  });

  it.each([
    ["missing", () => undefined],
    ["empty", (p: PhotoFile) => ({ ...p, bytes: new ArrayBuffer(0) })],
    ["not bytes", (p: PhotoFile) => ({ ...p, bytes: "photo" })],
    ["not an image", (p: PhotoFile) => ({ ...p, type: "text/plain" })],
  ])("no readable photo (%s) restores nothing", async (_, spoil) => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(photoRecord);
    const kept = (await storage.get("photo")) as { photo: PhotoFile };
    await storage.set("photo", { ...kept, photo: spoil(kept.photo) });
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it("an SVG design comes back as its file", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep(svgRecord);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(svgRecord);
  });

  it.each([
    ["no text", { name: "cat.svg" }],
    ["empty text", { name: "cat.svg", text: "" }],
    ["no name", { text: "<svg/>" }],
  ])("no readable SVG (%s) restores nothing", async (_, svg) => {
    const storage = memoryStorage();
    await storage.set("work", { version: 1, source: "svg", svg });
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it.each([
    ["no page", undefined],
    ["a page of no width", { width: 0, height: 1 }],
  ])("no readable page (%s) restores nothing", async (_, page) => {
    const storage = memoryStorage();
    await storage.set("work", { version: 1, source: "page", page, handTrace: pageRecord.handTrace });
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it("a record of no known source restores nothing", async () => {
    const storage = memoryStorage();
    await storage.set("work", { version: 1, source: "scanner" });
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it.each([
    ["a photo by a blank page", photoRecord, pageRecord],
    ["a blank page by a photo", pageRecord, photoRecord],
    ["a photo by another photo", photoRecord, { ...photoRecord, photo: { ...fakeJpeg(32), name: "cat.png", type: "image/png" } }],
    ["an SVG design by a photo", svgRecord, photoRecord],
  ])("replacing %s replaces the kept design", async (_, first, second) => {
    const storage = memoryStorage();
    const keeper = createRecordKeeper(storage, noShrink);
    await keeper.keep(first);
    await keeper.keep(second);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(second);
  });

  it("clearing the loaded design clears the kept one", async () => {
    const storage = memoryStorage();
    const keeper = createRecordKeeper(storage, noShrink);
    await keeper.keep(photoRecord);
    await keeper.keep(null);
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it("with two tabs, the last write wins", async () => {
    const storage = memoryStorage();
    const [first, second] = [createRecordKeeper(storage, noShrink), createRecordKeeper(storage, noShrink)];
    await first.keep(photoRecord);
    await second.keep(pageRecord);
    await first.keep({ ...photoRecord, done: false });
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual({ ...photoRecord, done: false });
    await second.keep({ ...pageRecord, handTrace: { ...pageRecord.handTrace, done: true } });
    expect((await createRecordKeeper(storage, noShrink).restore())?.source).toBe("page");
  });

  it("keeps made one after another without waiting are written in the order made", async () => {
    const storage = memoryStorage();
    const keeper = createRecordKeeper(storage, noShrink);
    await Promise.all([keeper.keep(photoRecord), keeper.keep({ ...photoRecord, done: false }), keeper.keep(pageRecord)]);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual(pageRecord);
    await Promise.all([keeper.keep(photoRecord), keeper.keep({ ...photoRecord, done: false })]);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual({ ...photoRecord, done: false });
  });

  it("work that's kept reports nothing wrong", async () => {
    const keeper = createRecordKeeper(memoryStorage(), noShrink);
    await keeper.keep(photoRecord);
    expect(keeper.keepsWork()).toBe(true);
  });

  it("a photo that won't fit is kept as its copy shrunk to 2048 px", async () => {
    const storage = limited(memoryStorage(), 100);
    const shrunk = fakeJpeg(50);
    const shrink = vi.fn<(photo: PhotoFile) => Promise<PhotoFile>>(() => Promise.resolve(shrunk));
    const keeper = createRecordKeeper(storage, shrink);
    await keeper.keep({ ...photoRecord, photo: fakeJpeg(500) });
    expect(shrink).toHaveBeenCalledWith(fakeJpeg(500));
    expect(keeper.keepsWork()).toBe(true);
    expect(await createRecordKeeper(storage, noShrink).restore()).toEqual({ ...photoRecord, photo: shrunk });
  });

  it("the shrunk copy is made once: later changes to the work don't retry the photo", async () => {
    const storage = counting(limited(memoryStorage(), 100));
    const shrink = vi.fn(() => Promise.resolve(fakeJpeg(50)));
    const keeper = createRecordKeeper(storage, shrink);
    const big = { ...photoRecord, photo: fakeJpeg(500) };
    await keeper.keep(big);
    await keeper.keep({ ...big, done: false });
    expect(shrink).toHaveBeenCalledTimes(1);
    expect(storage.photoWrites()).toBe(2);
    expect(await createRecordKeeper(storage, noShrink).restore()).toMatchObject({ done: false });
  });

  it("when the shrunk copy won't fit either, it reports that this browser won't keep the work", async () => {
    const storage = limited(memoryStorage(), 10);
    const keeper = createRecordKeeper(storage, () => Promise.resolve(fakeJpeg(50)));
    await keeper.keep(pageRecord);
    await keeper.keep({ ...photoRecord, photo: fakeJpeg(500) });
    expect(keeper.keepsWork()).toBe(false);
    // The blank page it replaced doesn't come back in its place.
    expect(await createRecordKeeper(storage, noShrink).restore()).toBeNull();
  });

  it("when the photo can't be shrunk, it reports that this browser won't keep the work", async () => {
    const keeper = createRecordKeeper(limited(memoryStorage(), 10), () => Promise.reject(new Error("no canvas")));
    await keeper.keep({ ...photoRecord, photo: fakeJpeg(500) });
    expect(keeper.keepsWork()).toBe(false);
  });

  it("the report stays once made, even when a later design fits", async () => {
    const keeper = createRecordKeeper(limited(memoryStorage(), 10), () => Promise.resolve(fakeJpeg(50)));
    await keeper.keep({ ...photoRecord, photo: fakeJpeg(500) });
    await keeper.keep(pageRecord);
    expect(keeper.keepsWork()).toBe(false);
  });

  it.each([
    ["can't be reached", undefined],
    ["refuses every write", blocked()],
  ])("storage that %s reports that this browser won't keep the work, and restores nothing", async (_, storage) => {
    const keeper = createRecordKeeper(storage, noShrink);
    expect(await keeper.restore()).toBeNull();
    await keeper.keep(pageRecord);
    expect(keeper.keepsWork()).toBe(false);
  });

  it("a shape being drawn that isn't an open shape restores with none being drawn", async () => {
    const storage = memoryStorage();
    await createRecordKeeper(storage, noShrink).keep({ ...pageRecord, handTrace: { ...pageRecord.handTrace, drawing: 1 } });
    const restored = await createRecordKeeper(storage, noShrink).restore();
    expect(restored).toEqual({ ...pageRecord, handTrace: { ...pageRecord.handTrace, drawing: null } });
  });
});
