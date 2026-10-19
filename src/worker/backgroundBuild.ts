import type { BuildProgress, TemplateInput } from "../core";
import type { BuildOutcome, BuildRequest, BuildResponse } from "./protocol";

export type { BuildOutcome };

export interface BackgroundBuild {
  /**
   * Build the template for `input` once typing pauses. Replaces any request not yet started; a build already
   * running stops at its next slit and its result is dropped.
   */
  request(input: TemplateInput): void;
  /** Drop any pending or running build: no result arrives until the next `request`. */
  cancel(): void;
}

/** Pause after the last edit before a build starts. */
const DEBOUNCE_MS = 250;

/**
 * Builds the template in a Web Worker. Only the progress and result for the latest request reach `onProgress` and
 * `onOutcome`; the worker drops older builds between slits. If the worker itself breaks (fails to load, or a reply
 * can't be read), the latest request fails and the next one starts a fresh worker.
 */
export function startBackgroundBuild(onOutcome: (outcome: BuildOutcome) => void, onProgress: (progress: BuildProgress) => void): BackgroundBuild {
  let worker = spawn();
  let latest = 0;
  /** Whether the latest request still waits for its outcome (false after `cancel` or once delivered). */
  let waiting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function spawn(): Worker {
    const w = new Worker(new URL("./templateWorker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (e: MessageEvent<BuildResponse>) => {
      if (e.data.id !== latest || !waiting) return;
      if (e.data.kind === "progress") {
        onProgress({ slits: e.data.slits });
        return;
      }
      const { kind: _, id: __, ...outcome } = e.data;
      waiting = false;
      onOutcome(outcome);
    });
    const broken = (message: string) => {
      w.terminate();
      worker = spawn();
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

  const send = (request: BuildRequest) => worker.postMessage(request);

  return {
    request(input) {
      const id = ++latest;
      waiting = true;
      clearTimeout(timer);
      // Stop the running build now; the new one starts once typing pauses.
      send({ id, input: null });
      timer = setTimeout(() => {
        timer = undefined;
        send({ id, input });
      }, DEBOUNCE_MS);
    },
    cancel() {
      latest++;
      waiting = false;
      clearTimeout(timer);
      timer = undefined;
      send({ id: latest, input: null });
    },
  };
}
