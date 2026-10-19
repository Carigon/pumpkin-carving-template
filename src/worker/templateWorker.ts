import { createTemplateBuilder } from "../core";
import type { BuildRequest, BuildResponse } from "./protocol";

// Flattening, slits and stretch, off the main thread. The builder keeps the mesh until the measurements change.
const builder = createTemplateBuilder();

self.addEventListener("message", (e: MessageEvent<BuildRequest>) => {
  const { id, input } = e.data;
  let response: BuildResponse;
  try {
    const { template, warnings } = builder.build(input);
    response = { id, ok: true, template, warnings };
  } catch (err) {
    response = { id, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
});
