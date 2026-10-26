/**
 * Small checks for values read back from storage or a file, shared by the settings, the record module and the
 * hand-trace file. Each gives the value back when it passes, else undefined.
 */

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function oneOf<T extends string>(x: unknown, options: readonly T[]): T | undefined {
  return options.includes(x as T) ? (x as T) : undefined;
}

export function finite(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

export function positive(x: unknown): number | undefined {
  const n = finite(x);
  return n !== undefined && n > 0 ? n : undefined;
}

export function inRange(x: unknown, min: number, max: number): number | undefined {
  const n = finite(x);
  return n !== undefined && n >= min && n <= max ? n : undefined;
}

export function integerIn(x: unknown, min: number, max: number): number | undefined {
  const n = inRange(x, min, max);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}
