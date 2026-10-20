/** The "Ask before deleting a ring" preference, as the header's settings menu holds it. */
export interface DeletePreference {
  asking(): boolean;
  /** "Don't ask again" was ticked: stop asking (and remember that). */
  stopAsking(): void;
}

/**
 * Asks before a ring is deleted with its ×, shared by the Blueprint view and the Measure form. Resolves true to
 * go ahead: at once when asking is turned off, else when the carver confirms. Ticking "Don't ask again" and
 * confirming turns asking off. (The Delete key deletes without asking, so it doesn't come here.)
 */
export type ConfirmDelete = (what: string) => Promise<boolean>;

/** Mount the confirmation as a modal dialog on `host` (e.g. `document.body`). */
export function mountDeleteConfirm(host: HTMLElement, preference: DeletePreference): ConfirmDelete {
  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog";
  dialog.setAttribute("aria-labelledby", "confirm-delete-title");
  dialog.innerHTML = `
    <form method="dialog">
      <p id="confirm-delete-title" class="confirm-title"></p>
      <label class="confirm-dont-ask"><input type="checkbox" name="dont-ask" /> Don't ask again</label>
      <div class="confirm-actions">
        <button type="submit" value="cancel" autofocus>Cancel</button>
        <button type="submit" value="delete" class="confirm-delete">Delete</button>
      </div>
    </form>
  `;
  host.append(dialog);
  const title = dialog.querySelector<HTMLElement>(".confirm-title")!;
  const dontAsk = dialog.querySelector<HTMLInputElement>('input[name="dont-ask"]')!;
  let settle: ((ok: boolean) => void) | null = null;

  dialog.addEventListener("close", () => {
    const ok = dialog.returnValue === "delete";
    if (ok && dontAsk.checked) preference.stopAsking();
    settle?.(ok);
    settle = null;
  });

  return (what) => {
    if (!preference.asking()) return Promise.resolve(true);
    // One question at a time: a second × while it's open is a no.
    if (settle) return Promise.resolve(false);
    title.textContent = `Delete ${what}?`;
    dontAsk.checked = false;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      settle = resolve;
    });
  };
}
