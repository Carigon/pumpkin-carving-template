import type { DesignRecord, PhotoFile } from "../designRecord";
import type { HandTrace } from "../handTrace";
import type { Cleanup } from "../input/cleanupFrame";
import { handTraceFileName, writeHandTraceFile } from "../input/handTraceFile";
import { filePhoto } from "../input/shrinkPhoto";
import { downloadBlob } from "./download";

/** What Download SVG writes, each read when it's pressed. */
interface DownloadSource {
  /** The hand-trace to write; null with none. */
  handTrace(): HandTrace<Cleanup> | null;
  /** The loaded design's record, which the file carries. */
  record(): DesignRecord | null;
  /** The width to write it at, in mm. */
  width(): number;
}

export interface DownloadSvg {
  /** Show Download SVG for `handTrace`, the hand-trace it writes (null hides it); disabled while it has no points. */
  show(handTrace: HandTrace<Cleanup> | null): void;
}

/**
 * The Download SVG buttons under `root` (`[data-download-svg]`: below Done/Edit and in the "won't keep your work"
 * line). Pressed, they download the hand-trace as a hand-trace file.
 */
export function mountDownloadSvg(root: HTMLElement, source: DownloadSource): DownloadSvg {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-download-svg]"));
  /** The loaded photo as its hand-trace file carries it, made once per photo. */
  let forFile: { of: PhotoFile; photo: Promise<PhotoFile> } | null = null;
  const download = async () => {
    const editor = source.handTrace();
    const kept = source.record();
    if (!editor || !kept || kept.source === "svg") return;
    if (kept.source === "photo" && forFile?.of !== kept.photo) {
      const chosen = kept.photo;
      // A photo that loaded but won't decode again here goes in as chosen.
      forFile = { of: chosen, photo: filePhoto(chosen).catch(() => chosen) };
    }
    const fileRecord = kept.source === "photo" && forFile ? { ...kept, photo: await forFile.photo } : kept;
    const text = writeHandTraceFile({
      record: fileRecord,
      page: editor.page(),
      pathData: editor.pathData(),
      design: editor.design(),
      width: source.width(),
    });
    const name = kept.source === "photo" ? kept.photo.name : kept.name;
    downloadBlob(new Blob([text], { type: "image/svg+xml" }), handTraceFileName(new Date(), name));
  };
  for (const b of buttons) b.addEventListener("click", () => void download());
  return {
    show(handTrace) {
      for (const b of buttons) {
        b.hidden = handTrace === null;
        b.disabled = (handTrace?.counts().points ?? 0) === 0;
      }
    },
  };
}
