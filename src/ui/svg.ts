/** Small SVG helpers shared by the views that draw with SVG. */

const SVG = "http://www.w3.org/2000/svg";

/** `v` rounded to `decimals` places, to keep SVG attributes short. */
export function roundTo(v: number, decimals: number): number {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

/**
 * An SVG element with `attrs`. Numbers are rounded to `decimals` places when it's given, else written as they are
 * (for callers that round as they go).
 */
export function el(name: string, attrs: Record<string, string | number>, decimals?: number): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(typeof v === "number" && decimals !== undefined ? roundTo(v, decimals) : v));
  }
  return node;
}
