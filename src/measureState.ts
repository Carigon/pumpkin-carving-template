import { sortRings, withRingIds, type Gap, type RingId, type RingMeasurements } from "./ringEdits";

/** Saved measurements to start from; null is an empty field. Ring positions are fractions of the height. */
export interface SavedMeasurements {
  /** In mm. */
  height?: number | null;
  rings?: { position: number | null; circumference: number | null }[];
}

/** In mm: 9 in tall, one 30 in ring at mid-height. */
const DEFAULTS = { height: 228.6, rings: [{ position: 0.5, circumference: 762 }] };

/**
 * The measurements to start from: the saved ones, or the defaults where nothing was saved, with ring ids
 * 0, 1, 2… and sorted top to bottom. Empty saved values are NaN, for the core to warn about.
 */
export function startingMeasurements(saved: SavedMeasurements = {}): RingMeasurements {
  const value = (x: number | null) => x ?? Number.NaN;
  const height = saved.height === undefined ? DEFAULTS.height : value(saved.height);
  const rings = saved.rings?.map((r) => ({ position: value(r.position), circumference: value(r.circumference) })) ?? DEFAULTS.rings;
  return sortRings(withRingIds({ height, rings }));
}

/** What's selected: a ring (its id), the height line, or nothing. */
export type Selection = RingId | "height" | null;

/** What the pointer is over: a ring (its id), a gap, or nothing. */
export type HoverTarget = RingId | Gap | null;

/** Whether two hover targets are the same ring, the same gap, or both nothing. */
export function sameHoverTarget(a: HoverTarget, b: HoverTarget): boolean {
  if (a === null || b === null || typeof a === "number" || typeof b === "number") return a === b;
  return a.above === b.above && a.below === b.below;
}

/**
 * The shared measurement state that the Measure form and the Blueprint view both render from. Every edit, from
 * either side, goes through the ring-edit rules (`ringEdits.ts`) and lands here.
 */
export interface MeasureState {
  /** In mm, each ring with its stable id. */
  measurements: RingMeasurements;
  /** The ring edited last (dragged, typed or added), which a shape-fit failure blames; null: none since the page loaded. */
  lastEdited: RingId | null;
  /** The ring selected (its id), the height line, or nothing. A ring id that's gone selects nothing. */
  selected: Selection;
  /** The ring (its id) or the gap the pointer is over, or nothing. */
  hovered: HoverTarget;
}

/** An edit's patch: the new measurements, and `edited` as the ring edited last unless it's null (the height, a delete). */
export function editPatch(measurements: RingMeasurements, edited: RingId | null): Partial<MeasureState> {
  return edited === null ? { measurements } : { measurements, lastEdited: edited };
}

/** Who changed the state, and whether a drag is still going. */
export interface MeasureChange {
  /** Where the edit came from, so that side isn't redrawn under the carver. */
  source: "form" | "view";
  /**
   * A drag (or held arrow key) still in progress: views follow it, but the 3D view and the template wait for it
   * to end, which comes as a last change with `live: false`. A change of selection or hover alone rebuilds nothing.
   */
  live: boolean;
}

export type MeasureListener = (state: MeasureState, change: MeasureChange) => void;

export interface MeasureStore {
  get(): MeasureState;
  /** Change some of the state and tell every listener. */
  set(patch: Partial<MeasureState>, change: MeasureChange): void;
  /** Hear every change from now on; returns a function that stops it. */
  subscribe(listener: MeasureListener): () => void;
}

export function createMeasureStore(initial: MeasureState): MeasureStore {
  let state = initial;
  const listeners = new Set<MeasureListener>();
  return {
    get: () => state,
    set(patch, change) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state, change);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
