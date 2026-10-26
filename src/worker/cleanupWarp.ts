import type { CleanedUp } from "../input/cleanupFrame";
import type { WarpRequest, WarpResponse } from "./protocol";

export interface CleanupWarp {
  /**
   * The cleaned-up photo for `cleaned` from `photo`'s pixels, made in a Web Worker. Null when a newer warp was asked
   * for meanwhile, so only the latest lands.
   */
  warp(photo: ImageData, cleaned: CleanedUp): Promise<ImageData | null>;
}

/** Warps photos in a Web Worker started on the first warp. If the worker breaks, the warps waiting on it fail. */
export function startCleanupWarp(): CleanupWarp {
  let worker: Worker | null = null;
  let latest = 0;
  const waiting = new Map<number, { resolve: (pixels: ImageData | null) => void; reject: (err: Error) => void }>();

  function spawn(): Worker {
    const w = new Worker(new URL("./cleanupWorker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (e: MessageEvent<WarpResponse>) => {
      const { id, pixels } = e.data;
      waiting.get(id)?.resolve(id === latest ? pixels : null);
      waiting.delete(id);
    });
    const broken = (message: string) => {
      w.terminate();
      worker = null;
      for (const { reject } of waiting.values()) reject(new Error(message));
      waiting.clear();
    };
    w.addEventListener("error", (e) => {
      e.preventDefault();
      broken(e.message || "The photo couldn't be cleaned up.");
    });
    w.addEventListener("messageerror", () => broken("The cleaned-up photo couldn't be read back."));
    return w;
  }

  return {
    warp(photo, { homography, width, height }) {
      worker ??= spawn();
      const id = ++latest;
      const done = new Promise<ImageData | null>((resolve, reject) => waiting.set(id, { resolve, reject }));
      worker.postMessage({ id, photo, homography, width, height } satisfies WarpRequest);
      return done;
    },
  };
}
