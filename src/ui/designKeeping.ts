import type { DesignRecord, PhotoFile, RecordKeeper } from "../designRecord";
import type { HandTrace, HandTraceRecord } from "../handTrace";
import type { Cleanup } from "../input/cleanupFrame";
import type { TracePanel } from "./tracePanel";

/** A hand-trace with nothing drawn: a new photo's. */
const EMPTY_HAND_TRACE: HandTraceRecord = { shapes: [], drawing: null, done: false };

/** What the Design card has loaded, as its record is made from it. */
interface Loaded {
  /** The loaded photo as chosen; null with none. */
  photo: PhotoFile | null;
  /** The loaded SVG design's file; null with none. */
  svg: { name: string; text: string } | null;
  /** The SVG file a hand-trace on a page was made from by Edit as hand-trace; undefined for a blank page's. */
  pageName: string | undefined;
  trace: TracePanel;
  /** The hand-trace being shown; null with none. */
  handTrace: HandTrace<Cleanup> | null;
}

/** The loaded design and the work on it, as the record keeps it; null with none loaded. */
export function designRecordOf({ photo, svg, pageName, trace, handTrace }: Loaded): DesignRecord | null {
  if (photo && trace.loaded())
    return {
      source: "photo",
      photo,
      cleanup: trace.cleanup(),
      tone: trace.tone(),
      inCleanup: trace.inCleanup(),
      autoTrace: trace.autoTrace(),
      handTrace: handTrace?.record() ?? EMPTY_HAND_TRACE,
      method: trace.method(),
      done: trace.accepted(),
    };
  const name = pageName === undefined ? {} : { name: pageName };
  if (handTrace) return { source: "page", page: handTrace.page(), handTrace: handTrace.record(), ...name };
  return svg && { source: "svg", svg };
}

export interface DesignKeeping {
  /** Keep the work after a finished change, once keeping has started. */
  keep(): void;
  /** The carver loaded a design: its work is kept from now on. */
  start(): void;
  /**
   * The kept record, read back; null when there's none, or when the carver loaded a design while it was being read
   * (it isn't put back then). Keeping has started either way.
   */
  restore(): Promise<DesignRecord | null>;
}

/**
 * Keeps `record()` with `keeper` after each finished change, and as it is when the tab is hidden. Once keeping
 * fails, `notKept` (the "won't keep your work" line) shows, for good.
 */
export function keepDesign(keeper: RecordKeeper, notKept: HTMLElement, record: () => DesignRecord | null): DesignKeeping {
  /** The kept design was restored, or the carver loaded one first: from now on the work is kept. */
  let keeping = false;
  const keep = () => {
    if (!keeping) return;
    void keeper.keep(record()).then(() => {
      notKept.hidden = keeper.keepsWork();
    });
  };
  // A phone may discard the tab once it's hidden: keep the work as it is then.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keep();
  });
  return {
    keep,
    start: () => void (keeping = true),
    async restore() {
      const kept = await keeper.restore();
      if (keeping) return null; // The carver loaded a design while it was being read.
      keeping = true;
      return kept;
    },
  };
}
