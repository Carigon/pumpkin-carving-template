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
  it("switching units back and forth never drifts the value", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, 6.13);

    for (let i = 0; i < 20; i++) {
      fields.setUnits("cm");
      fields.setUnits("in");
    }
    expect(fields.value(input)).toBe(6.13);
    expect(input.value).toBe("6.13");
  });

  it("shows a rounded value but reads the exact one, until the carver types a new value", () => {
    const { input, label, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, 6.13);

    fields.setUnits("cm");
    expect(input.value).toBe("15.57");
    expect(label.textContent).toBe("cm");
    expect(fields.value(input)).toBeCloseTo(6.13 * 2.54, 12);

    input.value = "20";
    expect(fields.value(input)).toBe(20);
  });

  it("reads an empty field as NaN", () => {
    const { input, root } = fakePanel();
    const fields = lengthFields(root, [input]);
    fields.set(input, null);
    expect(fields.value(input)).toBeNaN();
  });
});
