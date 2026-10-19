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

const full: Settings = {
  mode: "pumpkin",
  cells: 8,
  gridWidth: 12,
  units: "cm",
  measurements: {
    height: 25,
    rings: [
      { position: 0.5, circumference: 80 },
      { position: 0.25, circumference: null },
    ],
  },
  placement: { width: 15, verticalOffset: -2, rotation: 10 },
  slits: { count: 12, depth: 4 },
  cut: { margin: 2.5, line: false },
  paper: "a4",
  filled: true,
};

describe("settings", () => {
  it("restores what was saved", () => {
    const storage = memoryStorage();
    saveSettings(storage, full);
    expect(loadSettings(storage)).toEqual(full);
  });

  it("restores nothing when nothing was saved", () => {
    expect(loadSettings(memoryStorage())).toEqual({});
  });

  it.each(["{not json", "null", "42", '"text"', "[]"])("restores nothing from corrupt data %s", (raw) => {
    expect(loadSettings(memoryStorage({ "pumpkin-template-settings": raw }))).toEqual({});
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
      placement: { width: 15, verticalOffset: "up", rotation: 90 },
      slits: { count: 2.5, depth: 4 },
      cut: { margin: 0, line: "no" },
      paper: "tabloid",
      filled: "yes",
    };
    const storage = memoryStorage({ "pumpkin-template-settings": JSON.stringify(stored) });
    expect(loadSettings(storage)).toEqual({
      units: "cm",
      measurements: { rings: [{ position: 0.6, circumference: 20 }] },
      placement: { width: 15 },
      slits: { depth: 4 },
    });
  });

  it("drops measurements saved with a front arc and rings along it, so the form starts from its defaults", () => {
    const stored = {
      ...full,
      measurements: { circumference: 80, frontArc: 40, depth: null, circumferenceAt: 22, rings: [{ distance: 10, circumference: 60 }] },
    };
    const restored = loadSettings(memoryStorage({ "pumpkin-template-settings": JSON.stringify(stored) }));

    expect(restored.measurements).toBeUndefined();
    expect(restored.units).toBe("cm");
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

  it("drops lengths when the units are unknown, since they can't be interpreted", () => {
    const stored = { ...full, units: "furlongs" };
    const storage = memoryStorage({ "pumpkin-template-settings": JSON.stringify(stored) });
    expect(loadSettings(storage)).toEqual({
      mode: "pumpkin",
      cells: 8,
      slits: { count: 12 },
      placement: { rotation: 10 },
      cut: { line: false },
      paper: "a4",
      filled: true,
    });
  });
});
