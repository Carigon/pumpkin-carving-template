import type { TemplateInput } from "../core";
import type { BuildOutcome, BuildRequest, BuildResponse } from "./protocol";

export type { BuildOutcome };

export interface BackgroundBuild {
  /**
   * Build the template for `input` once typing pauses. Replaces any request not yet started; a build already
   * running finishes, but its result is dropped.
   */
  request(input: TemplateInput): void;
  /** Drop any pending or running build: no result arrives until the next `request`. */
  cancel(): void;
}

/** Pause after the last edit before a build starts. */
const DEBOUNCE_MS = 250;

/**
 * Builds the template in a Web Worker. At most one build runs at a time, and only the result for the latest
 * request reaches `onOutcome`. If the worker itself breaks (fails to load, or a reply can't be read), the latest
 * request fails and the next one starts a fresh worker.
 */
export function startBackgroundBuild(onOutcome: (outcome: BuildOutcome) => void): BackgroundBuild {
  let worker = spawn();
  let latest = 0;
  /** Whether the latest request still waits for its outcome (false after `cancel` or once delivered). */
  let waiting = false;
  let due: BuildRequest | null = null;
  /** Whether the worker is on a build. */
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function spawn(): Worker {
    const w = new Worker(new URL("./templateWorker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (e: MessageEvent<BuildResponse>) => {
      running = false;
      const { id, ...outcome } = e.data;
      if (id === latest && waiting) {
        waiting = false;
        onOutcome(outcome);
      }
      send();
    });
    const broken = (message: string) => {
      w.terminate();
      worker = spawn();
      running = false;
      due = null;
      if (waiting && timer === undefined) {
        waiting = false;
        onOutcome({ ok: false, message });
      }
    };
    w.addEventListener("error", (e) => {
      e.preventDefault();
      broken(e.message || "The template build failed.");
    });
    w.addEventListener("messageerror", () => broken("The template couldn't be read back from the build."));
    return w;
  }

  function send(): void {
    if (running || !due) return;
    worker.postMessage(due);
    running = true;
    due = null;
  }

  return {
    request(input) {
      const id = ++latest;
      waiting = true;
      clearTimeout(timer);
      due = null;
      timer = setTimeout(() => {
        timer = undefined;
        due = { id, input };
        send();
      }, DEBOUNCE_MS);
    },
    cancel() {
      latest++;
      waiting = false;
      clearTimeout(timer);
      timer = undefined;
      due = null;
    },
  };
}
