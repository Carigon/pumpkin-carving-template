import type { Gap, RingId, RingMeasurements } from "./ringEdits";

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
  selected: RingId | "height" | null;
  /** The ring (its id) or the gap the pointer is over, or nothing. */
  hovered: RingId | Gap | null;
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
