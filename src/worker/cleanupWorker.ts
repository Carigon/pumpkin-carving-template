import { warpPhoto } from "../input/cleanupFrame";
import type { WarpRequest, WarpResponse } from "./protocol";

// The cleanup's warp, off the main thread: a few hundred ms on a phone for a 2000 px cleaned-up photo.
self.addEventListener("message", (e: MessageEvent<WarpRequest>) => {
  const { id, photo, homography, width, height } = e.data;
  const pixels = new ImageData(warpPhoto(photo, homography, width, height), width, height);
  self.postMessage({ id, pixels } satisfies WarpResponse, { transfer: [pixels.data.buffer] });
});
