import { describe, expect, it } from "vitest";
import { lengthFields } from "../src/ui/lengthFields";

/** Just enough of an input and a panel for the helper (no DOM in the test environment). */
function fakePanel() {
  const input = { value: "" } as HTMLInputElement;
  const label = { textContent: "in" };
  const root = { querySelectorAll: () => [label] } as unknown as HTMLElement;
  return { input, label, root };
}

describe("length fields", () => {
  it("hold mm and show them in the display units", () => {
    const { input, label, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, 155.702);

    expect(input.value).toBe("6.13");
    expect(fields.value(input)).toBe(155.702);

    fields.setUnits("cm");
    expect(input.value).toBe("15.6");
    expect(label.textContent).toBe("cm");
    expect(fields.value(input)).toBe(155.702);
  });

  it("show inches to 0.01 and centimetres to 0.1", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, 19.05);
    expect(input.value).toBe("0.75");
    fields.setUnits("cm");
    expect(input.value).toBe("1.9");
  });

  it("switching units back and forth never changes the mm value", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, 155.702);

    for (let i = 0; i < 20; i++) {
      fields.setUnits("cm");
      fields.setUnits("in");
    }
    expect(fields.value(input)).toBe(155.702);
    expect(input.value).toBe("6.13");
  });

  it("reads what the carver types in the display units, as mm", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, 100);

    input.value = "2";
    expect(fields.value(input)).toBeCloseTo(50.8, 12);

    fields.setUnits("cm");
    expect(input.value).toBe("5.1");
    expect(fields.value(input)).toBeCloseTo(50.8, 12);
    input.value = "20";
    expect(fields.value(input)).toBeCloseTo(200, 12);
  });

  it("fields added later (e.g. a new ring) follow unit switches; removed ones don't", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, []);
    const removed = { value: "" } as HTMLInputElement;
    fields.add(input);
    fields.add(removed);
    fields.set(input, 254);
    fields.set(removed, 254);
    fields.remove(removed);

    fields.setUnits("cm");
    expect(input.value).toBe("25.4");
    expect(fields.value(input)).toBe(254);
    expect(removed.value).toBe("10");
  });

  it("reads an empty field as NaN", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, null);
    expect(fields.value(input)).toBeNaN();
  });
});
