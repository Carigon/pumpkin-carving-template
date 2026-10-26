import type { Design } from "../core";
import type { PhotoRecord, TracingMethod } from "../designRecord";
import type { HandTrace, HandTraceRecord } from "../handTrace";
import type { Cleanup } from "../input/cleanupFrame";
import type { HandTraceCanvas } from "./handTraceCanvas";
import type { TracePanel } from "./tracePanel";

/** The status line while a photo is in Cleanup. */
export const CLEANUP_HINT = "Frame the sheet in the photo, then press Start tracing.";
/** The status line while auto-trace runs. */
const AUTO_TRACING = "Auto-tracing…";

/** What the Design card does for a loaded photo by its tracing method. */
interface MethodBehaviour {
  /** Where the photo's design comes from, for its warnings' wording. */
  source: "auto-trace" | "hand-trace";
  /** The view the hand-trace canvas is in: the Photo view while hand-trace is chosen, none while it's hidden. */
  handTraceView: "photo" | null;
  /** The photo's design: the method's result, even an empty one. */
  design(autoDesign: Design | null, handTrace: HandTrace<Cleanup> | null): Design | null;
  /** Past Cleanup the status line shows auto-trace's last word, not the file hint. */
  showsAutoStatus: boolean;
  /** The hand-trace's Done, given the photo's: Done only while hand-trace is chosen. */
  handTraceDone(accepted: boolean): boolean;
}

/** Each tracing method's behaviour: the one place the Design card tells them apart. */
const TRACING_METHODS: Record<TracingMethod, MethodBehaviour> = {
  auto: {
    source: "auto-trace",
    handTraceView: null,
    design: (autoDesign) => autoDesign,
    showsAutoStatus: true,
    handTraceDone: () => false,
  },
  hand: {
    source: "hand-trace",
    handTraceView: "photo",
    design: (_, handTrace) => handTrace?.design() ?? null,
    showsAutoStatus: false,
    handTraceDone: (accepted) => accepted,
  },
};

/** A line on the Design card's status line; `failed` shows it as a warning. */
interface Status {
  text: string;
  failed: boolean;
}

export interface PhotoMethods {
  /** A new photo: no auto-trace result yet. */
  forget(): void;
  /** Auto-trace started. */
  autoTracing(): void;
  /** Auto-trace's result and its status line, kept while hand-trace is chosen. */
  autoTraced(design: Design | null, status: Status): void;
  /** The chosen method's design, even an empty one. */
  design(): Design | null;
  /** The photo's status line: Cleanup's hint, auto-trace's last word while it's chosen; null for the file hint. */
  status(): Status | null;
  /** Put the hand-trace's Done in step with the photo's: Done only while hand-trace is chosen and accepted. */
  syncDone(): void;
  /** `kept`'s hand-trace as it reopens, its Done in step with the photo's. */
  keptHandTrace(kept: PhotoRecord): HandTraceRecord;
  /** Where the chosen method's design comes from, for the warnings' wording. */
  source(): MethodBehaviour["source"];
  /** The view the hand-trace canvas is in: the Photo view while hand-trace is chosen, else none. */
  handTraceView(): MethodBehaviour["handTraceView"];
}

/**
 * The loaded photo's two tracing methods, kept in step: auto-trace's result beside the hand-trace (the other
 * method's work is kept, not used), and what the chosen one gives the Design card.
 */
export function photoMethods(trace: TracePanel, handTrace: HandTraceCanvas): PhotoMethods {
  let autoDesign: Design | null = null;
  let autoStatus: Status = { text: "", failed: false };
  const chosen = () => TRACING_METHODS[trace.method()];
  return {
    forget() {
      [autoDesign, autoStatus] = [null, { text: "", failed: false }];
    },
    autoTracing() {
      autoStatus = { text: AUTO_TRACING, failed: false };
    },
    autoTraced(design, status) {
      [autoDesign, autoStatus] = [design, status];
    },
    design: () => chosen().design(autoDesign, handTrace.editor()),
    status() {
      if (autoStatus.failed || (chosen().showsAutoStatus && !trace.inCleanup())) return autoStatus;
      return trace.inCleanup() ? { text: CLEANUP_HINT, failed: false } : null;
    },
    syncDone: () => handTrace.setDone(chosen().handTraceDone(trace.accepted())),
    keptHandTrace: (kept) => ({ ...kept.handTrace, done: TRACING_METHODS[kept.method].handTraceDone(kept.done) }),
    source: () => chosen().source,
    handTraceView: () => chosen().handTraceView,
  };
}
