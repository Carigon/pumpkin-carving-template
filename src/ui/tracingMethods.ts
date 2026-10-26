import type { Design } from "../core";
import type { TracingMethod } from "../designRecord";
import type { HandTrace } from "../handTrace";
import type { Cleanup } from "../input/cleanupFrame";

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
export const TRACING_METHODS: Record<TracingMethod, MethodBehaviour> = {
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
