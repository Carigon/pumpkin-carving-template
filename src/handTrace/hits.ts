import { distanceToSegment, insidePolygon, polylineLength, signedArea } from "../core";
import { copy, type Editor, type Selection } from "./context";
import { edgeAt, edgePolyline, edgesOf, handlesOf, neighbour, type Edge, type Side, type XY } from "./curves";
import type { ScreenPoint } from "./gestures";
import type { Shape } from "./model";
import type { PointAsDrawn } from "./symmetry";
import { toDesignSpace, toScreen } from "./view";

/**
 * Screen radius (px) within which a tap hits a point or a shape's edge, whatever the zoom; the axis snap's too, and
 * Cleanup's frame corners'.
 */
export const HIT_RADIUS_PX = 22;
/** Edges shorter than this on screen (px), measured along the curve, show no insert marker. */
const MARKER_MIN_EDGE_PX = 48;
/** How far out (screen px) a corner's stub reaches along its edge. */
const STUB_PX = 40;
/** Straight pieces a curved edge is taken as for hits, markers and the inside test. */
export const CURVE_PIECES = 16;

/**
 * What's under a tap or the start of a drag: a point (its shape and index), a handle or stub, an insert marker, or a
 * shape by its edge or inside. `reflected` when it's a mirrored shape's reflection that's under it.
 */
export type Hit =
  | { kind: "point"; shape: Shape; index: number; reflected: boolean }
  | { kind: "handle"; knob: Knob }
  | { kind: "marker"; marker: Marker }
  | { kind: "shape"; shape: Shape; reflected: boolean };

/**
 * A handle or stub showing for the selected point, in design space: on `side` of `pointAsDrawn` (the `k`th point of
 * the shape as drawn `o`), from `base` to `tip`; `source` says which of the shape's handles that is, and whether the
 * drawing mirrors it. `role` is the selected point's own, or a neighbour's on one of its edges.
 */
export interface Knob {
  shape: Shape;
  o: number;
  k: number;
  pointAsDrawn: PointAsDrawn;
  side: Side;
  source: { side: Side; mirrored: boolean };
  base: XY;
  tip: XY;
  stub: boolean;
  role: "own" | "neighbour";
}

/**
 * An insert marker, in design space: in the middle of `shape`'s edge from point `after` to the next, or of a
 * symmetric shape's straight `join` across the axis at its half's start or end; `reflected` when it's drawn on the
 * reflection.
 */
export interface Marker {
  shape: Shape;
  at: XY;
  reflected: boolean;
  insert: { after: number } | { join: "start" | "end" };
}

/**
 * What a tap or click at a spot would do, and what it would act on: place a point; close or end the shape being
 * drawn on its first or last point; select a point or shape (ending the shape being drawn); add a point at an
 * insert marker; clear the selection; or nothing. One rule for tapping and for showing a hover.
 */
export type TapAction =
  | { do: "place" }
  | { do: "close" | "end"; hit: Hit & { kind: "point" } }
  | { do: "select"; hit: Hit; selection: Selection }
  | { do: "insert"; hit: Hit & { kind: "marker" } }
  | { do: "deselect" }
  | { do: "nothing" };

/** Hit tests on `ed`'s shapes as drawn, in screen coordinates at its zoom and pan. */
export function createHits(ed: Editor) {
  /**
   * The insert markers on `shapes`' selected shape, its reflection's included: one at the middle (t = 0.5) of each
   * edge long enough on screen, measured along the curve.
   */
  const markers = (shapes: readonly Shape[]): Marker[] => {
    const shape = ed.state.drawing === null && ed.selection && shapes.find((s) => s.id === ed.selection?.shape);
    if (!shape) return [];
    return ed.asDrawn(shape).flatMap(({ shape: drawn, pointsAsDrawn }) =>
      edgesOf(drawn).flatMap((e): Marker[] => {
        if (polylineLength(edgePolyline(e, CURVE_PIECES)) * ed.view.scale < MARKER_MIN_EDGE_PX) return [];
        const [u, v] = [pointsAsDrawn[e.after], pointsAsDrawn[(e.after + 1) % pointsAsDrawn.length]];
        // A point and its own reflection: a symmetric shape's join across the axis, at its half's start or end.
        const insert =
          u.index === v.index
            ? { join: u.reflected ? ("start" as const) : ("end" as const) }
            : { after: Math.abs(u.index - v.index) === 1 ? Math.min(u.index, v.index) : Math.max(u.index, v.index) };
        if (u.index === v.index && u.reflected === v.reflected) return [];
        return [{ shape, at: edgeAt(e, 0.5), reflected: u.reflected || v.reflected, insert }];
      }),
    );
  };

  /**
   * The handles showing on `shapes` for the selected point, where it's drawn (on the reflection, if that's where it
   * was picked): its own, a stub on each side of a corner without one (pointing along that edge), and its
   * neighbours' on its two edges. None while drawing or with a shape selected, nor on a symmetric shape's straight
   * join across the axis.
   */
  const knobs = (shapes: readonly Shape[]): Knob[] => {
    const picked = ed.state.drawing === null && ed.selection?.kind === "point" ? ed.selection : null;
    const shape = picked && shapes.find((s) => s.id === picked.shape);
    const found = picked && shape?.points[picked.index] && ed.findAsDrawn(shape, picked.index, !!picked.reflected);
    if (!picked || !shape || !found) return [];
    const { shapeAsDrawn, o, k, at: p } = found;
    const { pointsAsDrawn, shape: drawn } = shapeAsDrawn;
    const acting = handlesOf(drawn);
    const out: Knob[] = [];
    const tipOf = (at: XY, h: XY) => ({ x: at.x + h.x, y: at.y + h.y });
    const knob = (j: number, side: Side, tip: XY, stub: boolean, role: Knob["role"]) => {
      const source = pointsAsDrawn[j][side];
      if (source) out.push({ shape, o, k: j, pointAsDrawn: pointsAsDrawn[j], side, source, base: drawn.points[j], tip, stub, role });
    };
    for (const side of ["in", "out"] as const) {
      const j = neighbour(drawn, k, side);
      if (j === null) continue;
      const facing = side === "in" ? "out" : "in";
      const own = acting[k][side];
      const q = drawn.points[j];
      if (own) knob(k, side, tipOf(p, own), false, "own");
      else if (shape.points[picked.index].kind === "corner") {
        // Along the edge as it leaves the point: towards the neighbour's handle on it, or the neighbour.
        const toward = acting[j][facing] ? tipOf(q, acting[j][facing]) : q;
        const d = Math.hypot(toward.x - p.x, toward.y - p.y);
        const reach = STUB_PX / ed.view.scale / d;
        if (d > 0) knob(k, side, { x: p.x + (toward.x - p.x) * reach, y: p.y + (toward.y - p.y) * reach }, true, "own");
      }
      const theirs = acting[j][facing];
      if (theirs) knob(j, facing, tipOf(q, theirs), false, "neighbour");
    }
    return out;
  };

  /**
   * What's under screen point `at`: the nearest point or handle within the hit radius (the shape being drawn
   * winning ties among points), else the nearest insert marker within it, else the nearest shape's edge within it, else
   * the smallest closed shape it's inside. Reflections count as their shapes.
   */
  const hitTest = (at: ScreenPoint): Hit | null => pointOrHandleAt(at) ?? markerAt(at) ?? shapeEdgeAt(at) ?? insideAt(at);

  const pointOrHandleAt = (at: ScreenPoint): Hit | null => {
    const point = pointAt(at);
    let best: Hit | null = null;
    let bestDistance = point ? point.distance : HIT_RADIUS_PX;
    for (const knob of knobs(ed.state.shapes)) {
      const s = toScreen(ed.view, knob.tip);
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bestDistance) [best, bestDistance] = [{ kind: "handle", knob }, d];
    }
    return best ?? point?.hit ?? null;
  };

  const markerAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const marker of markers(ed.state.shapes)) {
      const s = toScreen(ed.view, marker.at);
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bestDistance) [best, bestDistance] = [{ kind: "marker", marker }, d];
    }
    return best;
  };

  const pointAt = (at: ScreenPoint): { hit: Hit & { kind: "point" }; distance: number } | null => {
    let best: { hit: Hit & { kind: "point" }; distance: number } | null = null;
    const order = [...ed.state.shapes].sort((a, b) => Number(b.id === ed.state.drawing) - Number(a.id === ed.state.drawing));
    for (const shape of order) {
      for (const { shape: drawn, pointsAsDrawn } of ed.asDrawn(shape)) {
        pointsAsDrawn.forEach(({ index, reflected }, k) => {
          const s = toScreen(ed.view, drawn.points[k]);
          const d = Math.hypot(s.x - at.x, s.y - at.y);
          if (d < (best?.distance ?? HIT_RADIUS_PX)) best = { hit: { kind: "point", shape, index, reflected }, distance: d };
        });
      }
    }
    return best;
  };

  /** Along the curves, as drawn. */
  const shapeEdgeAt = (at: ScreenPoint): Hit | null => {
    let best: Hit | null = null;
    let bestDistance = HIT_RADIUS_PX;
    for (const shape of ed.state.shapes) {
      for (const { shape: drawn, reflected } of ed.asDrawn(shape)) {
        for (const e of edgesOf(drawn)) {
          const pts = edgePolyline(e, CURVE_PIECES).map((p) => toScreen(ed.view, p));
          for (let k = 1; k < pts.length; k++) {
            const d = distanceToSegment(at, pts[k - 1], pts[k]);
            if (d < bestDistance) [best, bestDistance] = [{ kind: "shape", shape, reflected }, d];
          }
        }
      }
    }
    return best;
  };

  const insideAt = (at: ScreenPoint): Hit | null => {
    const p = toDesignSpace(ed.view, at);
    const polygon = (s: Shape) => edgesOf(s).flatMap((e: Edge) => edgePolyline(e, CURVE_PIECES).slice(1));
    const around = ed.state.shapes
      .filter((s) => s.closed)
      .flatMap((s) => ed.asDrawn(s).map(({ shape: drawn, reflected }) => ({ s, reflected, poly: polygon(drawn) })))
      .filter(({ poly }) => insidePolygon(p, poly));
    const smallest = around.sort((a, b) => Math.abs(signedArea(a.poly)) - Math.abs(signedArea(b.poly)))[0];
    return smallest ? { kind: "shape", shape: smallest.s, reflected: smallest.reflected } : null;
  };

  /** The handle on `side` of point `k` of `shape` as drawn `o`, as it acts now. */
  const handleAt = (shape: Shape, o: number, k: number, side: Side) => {
    const shapeAsDrawn = ed.asDrawn(shape)[o];
    return shapeAsDrawn && handlesOf(shapeAsDrawn.shape)[k]?.[side];
  };

  /** What a tap at `at` would do, by what's under it and whether a shape is being drawn. */
  const tapAction = (at: ScreenPoint): TapAction => {
    const hit = hitTest(at);
    const shape = ed.drawingShape();
    if (hit?.kind === "point") {
      const picked = { kind: "point" as const, shape: hit.shape.id, index: hit.index, ...copy(hit.reflected) };
      const selects: TapAction = { do: "select", hit, selection: picked };
      if (!shape || hit.shape.id !== shape.id) return selects;
      if (hit.index === shape.points.length - 1) return { do: "end", hit };
      if (hit.index === 0) return shape.points.length >= 3 ? { do: "close", hit } : { do: "nothing" };
      return { do: "place" };
    }
    if (shape) return { do: "place" };
    if (hit?.kind === "handle") {
      const { knob } = hit;
      const handle = knob.stub ? {} : { handle: knob.side };
      const { index, reflected } = knob.pointAsDrawn;
      return { do: "select", hit, selection: { kind: "point", shape: knob.shape.id, index, ...copy(reflected), ...handle } };
    }
    if (hit?.kind === "marker") return { do: "insert", hit };
    if (hit) return { do: "select", hit, selection: { kind: "shape", shape: hit.shape.id, ...copy(hit.reflected) } };
    return ed.selection ? { do: "deselect" } : { do: "place" };
  };

  return { hitTest, pointOrHandleAt, pointAt, knobs, markers, handleAt, tapAction };
}
