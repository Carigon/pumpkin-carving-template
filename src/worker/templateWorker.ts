import { createTemplateBuilder } from "../core";
import type { BuildRequest, BuildResponse } from "./protocol";

// Flattening, slits and stretch, off the main thread. The builder keeps the mesh until the measurements change.
const builder = createTemplateBuilder();
/** The newest request not yet started. */
let next: BuildRequest | null = null;
let running = false;

self.addEventListener("message", (e: MessageEvent<BuildRequest>) => {
  next = e.data;
  if (!running) void run();
});

/**
 * Build the newest request. Placing slits takes seconds, so between slits the build reports progress and lets
 * newer requests in; when one has arrived, it drops the build and starts on that one instead.
 */
async function run(): Promise<void> {
  running = true;
  while (next) {
    const { id, input } = next;
    next = null;
    if (!input) continue;
    const post = (response: BuildResponse) => self.postMessage(response);
    try {
      const steps = builder.steps(input);
      for (let step = steps.next(); ; step = steps.next()) {
        if (step.done) {
          post({ kind: "done", id, ok: true, template: step.value.template, warnings: step.value.warnings });
          break;
        }
        post({ kind: "progress", id, ...step.value });
        await new Promise((resolve) => setTimeout(resolve));
        if (next) break;
      }
    } catch (err) {
      post({ kind: "done", id, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  running = false;
}
