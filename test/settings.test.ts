import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings, type Settings, type SettingsStorage } from "../src/settings";

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const KEY = "pumpkin-template-v2";

/** Lengths in mm; `units` is only how they're shown. */
const full: Settings = {
  mode: "pumpkin",
  cells: 8,
  gridWidth: 120,
  units: "cm",
  measurements: {
    height: 250,
    rings: [
      { position: 0.5, circumference: 800 },
      { position: 0.25, circumference: null },
    ],
  },
  placement: { width: 150, verticalOffset: -20, rotation: 10 },
  slits: { count: 12, maxDepth: 40 },
  cut: { margin: 25, line: false },
  paper: "a4",
  filled: true,
  step: "template",
  askBeforeDeletingRing: false,
};

/** Storage holding `stored` as the saved settings. */
function saved(stored: unknown): SettingsStorage {
  return memoryStorage({ [KEY]: JSON.stringify(stored) });
}

describe("settings", () => {
  it("restores what was saved", () => {
    const storage = memoryStorage();
    saveSettings(storage, full);
    expect(loadSettings(storage)).toEqual(full);
  });

  it("stores the lengths in mm under its own key, whatever the display units", () => {
    const storage = memoryStorage();
    saveSettings(storage, full);
    expect(Object.keys(storage.data)).toEqual([KEY]);
    const stored = JSON.parse(storage.data[KEY]) as Settings;
    expect(stored.measurements.height).toBe(250);
    expect(stored.cut.margin).toBe(25);
    expect(stored.units).toBe("cm");
  });

  it("ignores settings saved under the old key, which held lengths in the display units", () => {
    const old = memoryStorage({ "pumpkin-template-settings": JSON.stringify({ ...full, units: "in", measurements: { height: 9, rings: [] } }) });
    expect(loadSettings(old)).toEqual({});
  });

  it("restores nothing when nothing was saved", () => {
    expect(loadSettings(memoryStorage())).toEqual({});
  });

  it.each(["{not json", "null", "42", '"text"', "[]"])("restores nothing from corrupt data %s", (raw) => {
    expect(loadSettings(memoryStorage({ [KEY]: raw }))).toEqual({});
  });

  it("drops invalid values and keeps the valid ones", () => {
    const stored = {
      mode: "teapot",
      cells: 0,
      gridWidth: -1,
      units: "cm",
      measurements: {
        height: -5,
        rings: [{ position: 0.3, circumference: -2 }, 7, { position: 1.5, circumference: 20 }, { position: 0.6, circumference: 20 }],
      },
      placement: { width: 150, verticalOffset: "up", rotation: 90 },
      slits: { count: 2.5, maxDepth: 40 },
      cut: { margin: 0, line: "no" },
      paper: "tabloid",
      filled: "yes",
    };
    const storage = memoryStorage({ [KEY]: JSON.stringify(stored) });
    expect(loadSettings(storage)).toEqual({
      units: "cm",
      measurements: { rings: [{ position: 0.6, circumference: 20 }] },
      placement: { width: 150 },
      slits: { maxDepth: 40 },
      step: "measure",
      askBeforeDeletingRing: true,
    });
  });

  it("restores an Auto slit count", () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...full, slits: { count: "auto", maxDepth: 50 } });
    expect(loadSettings(storage).slits).toEqual({ count: "auto", maxDepth: 50 });
  });

  it("keeps working when storage is unavailable", () => {
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveSettings(broken, full)).not.toThrow();
    expect(loadSettings(broken)).toEqual({});
    expect(loadSettings(undefined)).toEqual({});
    expect(() => saveSettings(undefined, full)).not.toThrow();
  });

  it("stores only the settings, never a design or image that rides along", () => {
    const storage = memoryStorage();
    const withDesign = { ...full, design: { paths: [[{ x: 0, y: 0 }]] }, image: "data:image/png;base64,AAAA" };
    saveSettings(storage, withDesign);
    const raw = Object.values(storage.data).join("");
    expect(raw).not.toContain("design");
    expect(raw).not.toContain("image");
    expect(raw).not.toContain("paths");
  });

  it("keeps the lengths when the display units are unknown, since they're in mm either way", () => {
    const { units: _, ...rest } = full;
    expect(loadSettings(saved({ ...full, units: "furlongs" }))).toEqual(rest);
  });

  describe("last step", () => {
    it.each(["measure", "design", "template"] as const)("reopens on the %s step", (step) => {
      const storage = memoryStorage();
      saveSettings(storage, { ...full, step });
      expect(loadSettings(storage).step).toBe(step);
    });

    it("reopens on the grid step in test-grid mode", () => {
      const storage = memoryStorage();
      saveSettings(storage, { ...full, mode: "test-grid", step: "grid" });
      expect(loadSettings(storage).step).toBe("grid");
    });

    it.each([["teapot"], [3], [null], [{ id: "design" }], [undefined]])(
      "an unknown or corrupt step %j restores to Measure, keeping the rest",
      (step) => {
        const restored = loadSettings(saved({ ...full, step }));
        expect(restored.step).toBe("measure");
        expect(restored.paper).toBe("a4");
      },
    );

    it("a saved Design step opens as Grid in test-grid mode", () => {
      expect(loadSettings(saved({ ...full, mode: "test-grid", step: "design" })).step).toBe("grid");
    });

    it("a saved Grid step opens as Design in pumpkin mode", () => {
      expect(loadSettings(saved({ ...full, mode: "pumpkin", step: "grid" })).step).toBe("design");
    });

    it("a saved Grid step opens as Design when the mode can't be read (the app starts in pumpkin mode)", () => {
      expect(loadSettings(saved({ ...full, mode: "teapot", step: "grid" })).step).toBe("design");
    });
  });

  describe("ask before deleting a ring", () => {
    it.each([true, false])("round-trips %s", (ask) => {
      const storage = memoryStorage();
      saveSettings(storage, { ...full, askBeforeDeletingRing: ask });
      expect(loadSettings(storage).askBeforeDeletingRing).toBe(ask);
    });

    it.each([["yes"], [1], [null], [{}], [undefined]])("a missing or corrupt value %j restores to on, keeping the rest", (ask) => {
      const restored = loadSettings(saved({ ...full, askBeforeDeletingRing: ask }));
      expect(restored.askBeforeDeletingRing).toBe(true);
      expect(restored.paper).toBe("a4");
    });
  });
});
