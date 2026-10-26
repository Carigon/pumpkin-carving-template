import type { BBox, Design, Point2 } from "../core";
import { flattenPathData, roughExtent } from "./flattenPath";
import { bboxOf, RELATIVE_TOLERANCE } from "./pathDesign";

export interface SvgReadResult {
  /** Closed segmented paths in design units (y up), or null when nothing drawable was found. */
  design: Design | null;
  /** Problems worth telling the user about (not fatal unless design is null). */
  notes: string[];
}

const SKIP = new Set(["defs", "clipPath", "mask", "symbol", "marker", "pattern", "metadata", "title", "desc", "style", "script"]);

interface RawPath {
  d: string;
  transform: string;
  open: boolean;
}

/**
 * Read an SVG file's shapes into the builder's design format: closed polylines, y flipped to point up,
 * plus their bounding box. Open shapes (lines, polylines, unclosed paths) are closed, with a note.
 */
export function readSvgDesign(text: string): SvgReadResult {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length > 0 || root.localName !== "svg") {
    return { design: null, notes: ["This file isn't a valid SVG."] };
  }

  const raw: RawPath[] = [];
  let skippedUse = false;
  const walk = (el: Element, transforms: string[]) => {
    if (SKIP.has(el.localName)) return;
    if (el.getAttribute("display") === "none" || el.getAttribute("visibility") === "hidden") return;
    const t = el.getAttribute("transform");
    const chain = t ? [...transforms, t] : transforms;
    if (el.localName === "use") skippedUse = true;
    const shape = shapeToPath(el);
    if (shape) raw.push({ ...shape, transform: chain.join(" ") });
    for (const child of Array.from(el.children)) walk(child, chain);
  };
  walk(root, []);

  const notes: string[] = [];
  if (skippedUse) notes.push("Reused symbols (<use>) were ignored.");
  if (raw.length === 0) return { design: null, notes: [...notes, "No shapes found in this SVG."] };

  const extent = raw.map((r) => roughExtent(r.d, r.transform)).reduce(union);
  const tolerance = RELATIVE_TOLERANCE * Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 1e-9);

  const paths: Point2[][] = [];
  let closedOpen = false;
  for (const r of raw) {
    const flat = flattenPathData(r.d, r.transform, tolerance);
    if (r.open && flat.length > 0) closedOpen = true;
    for (const path of flat) paths.push(path.map(({ x, y }) => ({ x, y: -y })));
  }
  if (closedOpen) notes.push("Open lines were closed into shapes.");
  if (paths.length === 0) return { design: null, notes: [...notes, "No shapes with an area found in this SVG."] };

  return { design: { paths, bbox: bboxOf(paths) }, notes };
}

function shapeToPath(el: Element): { d: string; open: boolean } | null {
  const n = (name: string) => Number(el.getAttribute(name) ?? 0) || 0;
  switch (el.localName) {
    case "path": {
      const d = el.getAttribute("d") ?? "";
      return d.trim() ? { d, open: !/z\s*$/i.test(d.trim()) } : null;
    }
    case "rect": {
      const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
      if (!(w > 0 && h > 0)) return null;
      let rx = el.hasAttribute("rx") ? n("rx") : el.hasAttribute("ry") ? n("ry") : 0;
      let ry = el.hasAttribute("ry") ? n("ry") : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return { d: `M${x} ${y}H${x + w}V${y + h}H${x}Z`, open: false };
      const a = (ex: number, ey: number) => `A${rx} ${ry} 0 0 1 ${ex} ${ey}`;
      return {
        d:
          `M${x + rx} ${y}H${x + w - rx}${a(x + w, y + ry)}V${y + h - ry}${a(x + w - rx, y + h)}` +
          `H${x + rx}${a(x, y + h - ry)}V${y + ry}${a(x + rx, y)}Z`,
        open: false,
      };
    }
    case "circle":
    case "ellipse": {
      const [cx, cy] = [n("cx"), n("cy")];
      const rx = el.localName === "circle" ? n("r") : n("rx");
      const ry = el.localName === "circle" ? n("r") : n("ry");
      if (!(rx > 0 && ry > 0)) return null;
      return {
        d: `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`,
        open: false,
      };
    }
    case "polygon":
    case "polyline": {
      const nums = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      if (nums.length < 4 || nums.some((v) => !Number.isFinite(v))) return null;
      const pts: string[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${nums[i]} ${nums[i + 1]}`);
      return { d: `M${pts.join("L")}Z`, open: el.localName === "polyline" };
    }
    case "line":
      // A single line encloses no area; it flattens to nothing.
      return { d: `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}Z`, open: true };
    default:
      return null;
  }
}

function union(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
