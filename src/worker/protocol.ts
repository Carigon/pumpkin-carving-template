import type { FlatTemplate, TemplateInput, TemplateWarning } from "../core";

/** Main thread → worker: build the template for this input. */
export interface BuildRequest {
  id: number;
  input: TemplateInput;
}

/** The flat template and every warning for an input, or why the build failed. */
export type BuildOutcome =
  | { ok: true; template: FlatTemplate | null; warnings: TemplateWarning[] }
  | { ok: false; message: string };

/** Worker → main thread: the outcome for request `id`. */
export type BuildResponse = BuildOutcome & { id: number };
