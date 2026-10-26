# 2. The loaded design is kept across reloads, in IndexedDB

Status: accepted

## Context

Saved settings deliberately held "never images or designs" (`src/settings.ts`): a reload or a tab the browser
discarded lost the loaded photo or SVG and everything done to it. Hand-tracing changes that trade-off, since a
hand-trace can be an hour of placing points, and phones discard background tabs freely. Decided in Keeping a
hand-trace across reloads (issue #9 in `Carigon/pumpkin-carving-template`); hand-traces on a blank page were added in
Hand-tracing without a photo (issue #18).

## Decision

- **What's kept**: the loaded design and the work on it, whatever its source. For a photo: the photo, its cleanup,
  both tracing methods' work (the hand-trace and the auto-trace threshold, invert and speckle), the chosen
  tracing method and the Done/Edit state. For a blank page: the page's aspect (1:1, or shaped to an SVG design edited
  as a hand-trace), the hand-trace and the Done/Edit state, with no photo, cleanup or auto-trace side. For an SVG
  file: the file, until it's edited as a hand-trace; from then on only the hand-trace is kept, on a page or, for a
  changed hand-trace file whose record's photo still validates, on that photo (Editing a loaded SVG as a hand-trace,
  issue #20). One rule ("your loaded design comes back")
  rather than a hand-trace-only exception. One slot: only one design is ever loaded.
- **How**: the photo as the file exactly as chosen; cleanup as its settings, never as cleaned-up pixels; the
  hand-trace as the path model's data, with points relative to the photo's size; auto-trace re-runs only when its
  side is shown.
- **Where**: IndexedDB, apart from the settings, which stay in `localStorage`. `localStorage` holds only strings
  and about 5 MB; keeping them apart means a failure in one never costs the other.
- **When**: the photo once, when loaded; the rest after each finished change (a point placed, a drag ended, a
  cleanup handle or auto-trace slider released, a method switch, Done/Edit), never during a drag, and on
  `visibilitychange` to hidden. The stored work always matches the loaded work: replacing or clearing the design
  replaces or clears it. There is no separate "forget my work" control.
- **Restore**: silent, back to the same step and view, as settings are.
- **Failure**: if the photo won't fit, retry with a copy shrunk to 2048 px on the long edge (the relative points
  still line up); if that fails, or storage is blocked, the Design card says quietly and permanently "This browser
  won't keep your work after a reload", with a link to download the SVG. Losing a hand-trace silently is far
  worse than losing a ring measurement silently, so this breaks from the settings' silent failure.
- **Validation**: the record carries a version; an unknown version is ignored. Each part is checked on its own,
  like `loadSettings`: no readable photo, blank page or SVG restores nothing; an invalid hand-trace restores empty; invalid
  cleanup or auto-trace settings fall back to defaults. All silent.

## Considered options

- **A shrunk copy of the photo always**: smaller, but not what the carver traced over. Kept as the fallback.
- **Keeping only the hand-trace**: the photo is the expensive part; the rest is a few bytes, and an exception list
  is harder to explain than one rule.
- **`navigator.storage.persist()`**: Firefox asks the carver with a permission prompt, which is jarring mid-trace.

## Consequences

- Storage can still be cleared by the browser (Safari after 7 days without a visit, or under storage pressure).
  The SVG download is the carver's lasting copy; whether it reopens as an editable hand-trace is Downloading a
  hand-trace as SVG (issue #17).
- Two tabs share the slot and the last write wins, as with settings.
- Under ADR 0001, the record's validation is a thin pure helper with direct tests through a small storage
  interface; the IndexedDB wiring and the failure note are DOM wiring and stay untested.
