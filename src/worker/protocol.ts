import type { BuildProgress, FlatTemplate, TemplateInput, TemplateWarning } from "../core";
import type { Homography } from "../input/cleanupFrame";

/** Main thread → cleanup worker: warp `photo` into the cleaned-up photo `homography` and the size describe. */
export interface WarpRequest {
  id: number;
  photo: ImageData;
  homography: Homography;
  width: number;
  height: number;
}

/** Cleanup worker → main thread: the cleaned-up photo for request `id`. */
export interface WarpResponse {
  id: number;
  pixels: ImageData;
}

/**
 * Main thread → worker: build the template for this input, dropping any build still running. A null input only
 * drops it.
 */
export interface BuildRequest {
  id: number;
  input: TemplateInput | null;
}

/** The flat template and every warning for an input, or why the build failed. */
export type BuildOutcome =
  | { ok: true; template: FlatTemplate | null; warnings: TemplateWarning[] }
  | { ok: false; message: string };

/** Worker → main thread: how far the build for request `id` has got, or its outcome. */
export type BuildResponse = ({ kind: "progress" } & BuildProgress & { id: number }) | ({ kind: "done" } & BuildOutcome & { id: number });
